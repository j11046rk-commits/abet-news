/**
 * 原価（仕入・棚卸・ロス）の計算。DBにも画面にも依存しない純粋な関数だけを置く。
 *
 * 原価率 ＝（始めの在庫 ＋ その間の仕入 − 終わりの在庫）÷ その間の売上
 * 棚卸は基本「毎週日曜」（2026-11-09〜）。原価率は確定した棚卸と次の確定した棚卸の間ごとに出す。
 *
 * - 仕入も売上も**税抜**で比べる（税理士の月次報告と同じ物差し）。
 *   食材は8%、売上（店内）は10%なので、税込どうしで割ると約2ポイント低く出てしまう。
 * - 原価に入れるのは 食材＋酒・飲料。消耗品は別に出す（8月の報告で消耗品費が跳ねていたため、
 *   「消耗品込み」も並べて見せる）。
 * - 棚卸が両端にそろわない期間は「原価率」は出さない。仕入÷売上（仕入率）を目安としてだけ出す。
 *   在庫の増減を無視した数字を原価率と呼ぶと、仕入が多い月に間違った警報を鳴らすことになる。
 */
import type { SalesDay } from "./sales.ts";

/** 写真・PDFの置き場（非公開） */
export const COST_BUCKET = "cost-photos";
/** スキャンしたPDF（初回の請求書の束など）の上限。ブラウザから置き場へ直接送る（サーバーを通さない） */
export const PDF_MAX = 20 * 1024 * 1024;
export const isPdfPath = (p: string | null | undefined): boolean => !!p && p.toLowerCase().endsWith(".pdf");

export type DocKind = "slip" | "invoice" | "receipt";
export type CostCategory = "food" | "drink" | "supplies" | "other";
export type LossReason = "expired" | "overprep" | "mistake" | "damaged" | "other";

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  slip: "納品書",
  invoice: "請求書（月締め）",
  receipt: "レシート",
};

export const CATEGORY_LABEL: Record<CostCategory, string> = {
  food: "食材",
  drink: "酒・飲料",
  supplies: "消耗品",
  other: "その他",
};

export const LOSS_REASON_LABEL: Record<LossReason, string> = {
  expired: "期限切れ",
  overprep: "作りすぎ",
  mistake: "調理ミス",
  damaged: "傷み・破損",
  other: "その他",
};

/** 区分ごとの消費税率（税込しか分からないときに税抜へ戻すため）。酒は10%、食材は8% */
export const CATEGORY_TAX: Record<CostCategory, number> = {
  food: 0.08,
  drink: 0.1,
  supplies: 0.1,
  other: 0.1,
};

/** 税込→税抜（1円未満は四捨五入） */
export const exTax = (inclYen: number, rate: number): number => Math.round(inclYen / (1 + rate));

/** 読み取り待ち（撮っただけ）／未確認（読み取った・人がまだ見ていない）／確認済み */
export type PurchaseStatus = "pending" | "unconfirmed" | "confirmed";

export const STATUS_LABEL: Record<PurchaseStatus, string> = {
  pending: "読み取り待ち",
  unconfirmed: "未確認",
  confirmed: "確認済み",
};

export type Purchase = {
  id: string;
  book_date: string;
  /** 読み取り待ちの間は null */
  vendor: string | null;
  status?: PurchaseStatus;
  ai_note?: string | null;
  doc_kind: DocKind;
  food_ex: number;
  drink_ex: number;
  supplies_ex: number;
  other_ex: number;
  total_in: number | null;
  period_from?: string | null;
  period_to?: string | null;
  memo?: string | null;
  photo_path?: string | null;
  ai_read?: boolean;
};

export const purchaseEx = (p: Pick<Purchase, "food_ex" | "drink_ex" | "supplies_ex" | "other_ex">): number =>
  p.food_ex + p.drink_ex + p.supplies_ex + p.other_ex;

/**
 * 1日の売上を税抜にする。店内は10%、物販（持ち帰り）は8%。
 * 合計はレジの総額が正（lib/sales の salesView と同じ考え方）。
 */
export function salesExTax(s: SalesDay | null | undefined): number | null {
  if (!s) return null;
  const retail = s.tax8_yen ?? 0;
  if (s.actual_yen != null) return Math.round((s.actual_yen - retail) / 1.1 + retail / 1.08);
  if (s.tax10_yen != null || s.tax8_yen != null) return Math.round((s.tax10_yen ?? 0) / 1.1 + retail / 1.08);
  return null;
}

/** 業者名を比べるための正規化（空白・株式会社・全角半角の揺れを吸収） */
export function vendorKey(v: string): string {
  return v
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/(株式会社|有限会社|合同会社|\(株\)|\(有\)|㈱|㈲)/g, "")
    .toLowerCase();
}

export type PurchaseWarning = { ids: string[]; text: string };

/**
 * 二重計上のおそれ。止めはしない（返品・追加請求で正しく両方ある月もある）。
 *  1) 同じ業者の「請求書」と「納品書・レシート」が同じ月にある
 *  2) 同じ業者・同じ日・同じ金額が2回以上
 */
export function purchaseWarnings(list: Purchase[]): PurchaseWarning[] {
  const out: PurchaseWarning[] = [];
  const byVendor = new Map<string, Purchase[]>();
  for (const p of list) {
    if (p.status === "pending" || !p.vendor) continue;
    const k = vendorKey(p.vendor);
    byVendor.set(k, [...(byVendor.get(k) ?? []), p]);
  }
  for (const ps of byVendor.values()) {
    const inv = ps.filter((p) => p.doc_kind === "invoice");
    const other = ps.filter((p) => p.doc_kind !== "invoice");
    if (inv.length > 0 && other.length > 0) {
      out.push({
        ids: ps.map((p) => p.id),
        text: `${ps[0]!.vendor}：請求書と納品書（レシート）が両方あります。請求書がその納品書の合計なら、どちらか一方だけにしてください（二重になります）。`,
      });
    }
    const seen = new Map<string, Purchase[]>();
    for (const p of ps) {
      const k = `${p.book_date}|${purchaseEx(p)}`;
      seen.set(k, [...(seen.get(k) ?? []), p]);
    }
    for (const dup of seen.values()) {
      if (dup.length > 1) {
        out.push({
          ids: dup.map((p) => p.id),
          text: `${dup[0]!.vendor}（${Number(dup[0]!.book_date.slice(5, 7))}/${Number(dup[0]!.book_date.slice(8))}）：同じ金額が${dup.length}件あります。同じ書類を2回入れていませんか。`,
        });
      }
    }
  }
  return out;
}

/** ふだんは営業中（店主指示 2026-11-09「営業中の暇な時に。開店前・閉店後だと人件費が無駄」）。開店前／閉店後も残す */
export type StockTiming = "before_open" | "during" | "after_close";

export const TIMING_LABEL: Record<StockTiming, string> = {
  before_open: "開店前",
  during: "営業中",
  after_close: "閉店後",
};

/**
 * 棚卸。as_of＝この営業日の終わりまでの在庫（日曜の営業中・閉店後に数えたら日曜、開店前なら土曜）。
 * 店主指示 2026-11-09「毎週日曜に棚卸をする仕組みにしたい」。
 */
export type Stocktake = {
  as_of: string;
  counted_on: string;
  timing: StockTiming;
  status: "draft" | "done";
  total_ex: number | null;
};

// 日付（YYYY-MM-DD）の計算。暦の日付だけを扱うので UTC で数える（時差の影響を受けない）
const dayNum = (d: string): number => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000;
const fromDayNum = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10);
export const addDaysStr = (d: string, n: number): string => fromDayNum(dayNum(d) + n);
export const daysBetween = (from: string, to: string): number => dayNum(to) - dayNum(from) + 1;

/**
 * 数えた日と、いつ数えたかから、どの営業日の終わりまでの在庫かを決める。
 * 営業中に数えたら、その日の営業までとして扱う（数えたあとの売上ぶんだけずれるが、毎週同じなら比べ方は変わらない）
 */
export const asOfFor = (countedOn: string, timing: StockTiming): string =>
  timing === "before_open" ? addDaysStr(countedOn, -1) : countedOn;

/** その日を含む直近の日曜（棚卸の日の初期値） */
export const lastSunday = (date: string): string => addDaysStr(date, -new Date(dayNum(date) * 86_400_000).getUTCDay());

/** 「11/10〜11/16」 */
export const fmtSpan = (from: string, to: string): string => {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return from === to ? md(from) : `${md(from)}〜${md(to)}`;
};

/**
 * 書類の金額のうち、from〜to（両端を含む）に入る割合（0〜1）。
 * 月締めの請求書は対象期間が読めていれば日割りにする（週ごとの原価率が、締め日の週だけ跳ねないように）。
 * それ以外（納品書・レシート、期間の読めない請求書）は計上日で丸ごと。
 */
export function purchaseShare(p: Pick<Purchase, "doc_kind" | "book_date" | "period_from" | "period_to">, from: string, to: string): number {
  const pf = p.period_from;
  const pt = p.period_to;
  if (p.doc_kind === "invoice" && okDate(pf) && okDate(pt) && pf <= pt) {
    const lo = pf > from ? pf : from;
    const hi = pt < to ? pt : to;
    return lo > hi ? 0 : daysBetween(lo, hi) / daysBetween(pf, pt);
  }
  return p.book_date >= from && p.book_date <= to ? 1 : 0;
}

export type PeriodCost = {
  from: string;
  to: string;
  salesEx: number | null;
  /** 売上の入っている日数 */
  salesDays: number;
  food: number;
  drink: number;
  supplies: number;
  other: number;
  /** 原価に入れる仕入（食材＋酒・飲料） */
  cogsPurchase: number;
  openStock: number | null;
  closeStock: number | null;
  /** 売上原価（始めの在庫＋仕入−終わりの在庫）。棚卸が両方そろったときだけ */
  cogs: number | null;
  /** 原価率（%・小数第1位）。棚卸が両方そろい、売上があるときだけ */
  ratio: number | null;
  /** 消耗品込みの率（%）。原価率と同じ条件 */
  ratioWithSupplies: number | null;
  /** 仕入率（仕入÷売上・%）。棚卸が無くても出る目安 */
  purchaseRatio: number | null;
  /** 原価率が出ない理由（画面にそのまま出す） */
  missing: string[];
  /** 日割りした請求書がある */
  prorated: boolean;
};

const pct = (num: number, den: number | null): number | null =>
  den != null && den > 0 ? Math.round((num / den) * 1000) / 10 : null;

/**
 * from〜to（営業日・両端を含む）の原価。
 * 原価率 ＝（始めの在庫 ＋ 期間の仕入 − 終わりの在庫）÷ 期間の売上（どれも税抜）
 * open は from の前日の終わりまでの棚卸、close は to の終わりまでの棚卸（どちらも確定したものだけ使う）。
 */
export function periodCost(input: {
  from: string;
  to: string;
  sales: Map<string, SalesDay | null | undefined>;
  purchases: Purchase[];
  open: Stocktake | null;
  close: Stocktake | null;
}): PeriodCost {
  const { from, to } = input;
  let salesEx: number | null = null;
  let salesDays = 0;
  for (const [d, s] of input.sales) {
    if (d < from || d > to) continue;
    const v = salesExTax(s);
    if (v == null) continue;
    salesEx = (salesEx ?? 0) + v;
    salesDays += 1;
  }
  const sum = { food: 0, drink: 0, supplies: 0, other: 0 };
  let prorated = false;
  // 読み取り待ちは金額がまだ無い（0）ので足しても変わらないが、意図をはっきりさせて外す
  for (const p of input.purchases) {
    if (p.status === "pending") continue;
    const share = purchaseShare(p, from, to);
    if (share === 0) continue;
    if (share < 1) prorated = true;
    sum.food += p.food_ex * share;
    sum.drink += p.drink_ex * share;
    sum.supplies += p.supplies_ex * share;
    sum.other += p.other_ex * share;
  }
  const food = Math.round(sum.food);
  const drink = Math.round(sum.drink);
  const supplies = Math.round(sum.supplies);
  const other = Math.round(sum.other);
  const cogsPurchase = food + drink;

  const openStock = input.open?.status === "done" ? input.open.total_ex : null;
  const closeStock = input.close?.status === "done" ? input.close.total_ex : null;

  const missing: string[] = [];
  if (openStock == null) missing.push("始めの棚卸");
  if (closeStock == null) missing.push("終わりの棚卸");
  if (salesEx == null) missing.push("売上");

  const cogs = openStock != null && closeStock != null ? openStock + cogsPurchase - closeStock : null;

  return {
    from,
    to,
    salesEx,
    salesDays,
    food,
    drink,
    supplies,
    other,
    cogsPurchase,
    openStock,
    closeStock,
    cogs,
    ratio: cogs != null ? pct(cogs, salesEx) : null,
    ratioWithSupplies: cogs != null ? pct(cogs + supplies, salesEx) : null,
    purchaseRatio: pct(cogsPurchase, salesEx),
    missing,
    prorated,
  };
}

/** 確定した棚卸を古い順に並べ、となり合う2つの間を1区間にする（ふだんは1週間） */
export function stockPeriods(stocktakes: Stocktake[]): { open: Stocktake; close: Stocktake; from: string; to: string }[] {
  const done = stocktakes.filter((s) => s.status === "done").sort((a, b) => (a.as_of < b.as_of ? -1 : 1));
  const out: { open: Stocktake; close: Stocktake; from: string; to: string }[] = [];
  for (let i = 1; i < done.length; i++) {
    out.push({ open: done[i - 1]!, close: done[i]!, from: addDaysStr(done[i - 1]!.as_of, 1), to: done[i]!.as_of });
  }
  return out;
}

/** 棚卸の在庫額。空欄（数えていない品）は足さない */
export function stockTotal(counts: { qty: number | null; unit_price: number }[]): number {
  return Math.round(counts.reduce((a, c) => a + (c.qty != null ? c.qty * c.unit_price : 0), 0));
}

// ── AIの読み取り結果を、保存できる形に整える ──────────────────────

export type AiDoc = {
  doc_kind: DocKind;
  vendor: string;
  date: string | null;
  period_from: string | null;
  period_to: string | null;
  total_in: number | null;
  lines: { category: CostCategory; amount: number; tax_included: boolean; tax_rate: number | null }[];
  note: string;
};

export type PurchaseDraft = {
  doc_kind: DocKind;
  vendor: string;
  book_date: string;
  period_from: string | null;
  period_to: string | null;
  food_ex: number;
  drink_ex: number;
  supplies_ex: number;
  other_ex: number;
  total_in: number | null;
  note: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const okDate = (d: string | null | undefined): d is string => !!d && DATE_RE.test(d) && !Number.isNaN(Date.parse(d));

/**
 * AIが読んだ内容 → 確認画面の初期値。
 * 計上日：請求書は締め日（対象期間の終わり）、それ以外は書類の日付。読めなければ今日。
 * 金額：税込で読めた行は区分の税率（読めた税率があればそれ）で税抜に戻す。
 */
export function draftFromAi(ai: AiDoc, today: string): PurchaseDraft {
  const ex: Record<CostCategory, number> = { food: 0, drink: 0, supplies: 0, other: 0 };
  for (const l of ai.lines) {
    if (!Number.isFinite(l.amount)) continue;
    const rate = l.tax_rate === 0.08 || l.tax_rate === 0.1 ? l.tax_rate : CATEGORY_TAX[l.category];
    ex[l.category] += l.tax_included ? exTax(l.amount, rate) : Math.round(l.amount);
  }
  const book =
    ai.doc_kind === "invoice" && okDate(ai.period_to) ? ai.period_to : okDate(ai.date) ? ai.date : today;
  return {
    doc_kind: ai.doc_kind,
    vendor: ai.vendor.trim().slice(0, 80),
    book_date: book,
    period_from: okDate(ai.period_from) ? ai.period_from : null,
    period_to: okDate(ai.period_to) ? ai.period_to : null,
    food_ex: ex.food,
    drink_ex: ex.drink,
    supplies_ex: ex.supplies,
    other_ex: ex.other,
    total_in: ai.total_in != null && Number.isFinite(ai.total_in) ? Math.round(ai.total_in) : null,
    note: ai.note.slice(0, 300),
  };
}

/**
 * 税込合計と、区分ごとの税抜から逆算した税込が大きくずれていないか（読み違いの検出）。
 * ずれが2%かつ100円を超えたら確認を促す。
 */
export function totalMismatch(d: Pick<PurchaseDraft, "food_ex" | "drink_ex" | "supplies_ex" | "other_ex" | "total_in">): number | null {
  if (d.total_in == null) return null;
  const est = Math.round(d.food_ex * 1.08 + d.drink_ex * 1.1 + d.supplies_ex * 1.1 + d.other_ex * 1.1);
  const diff = d.total_in - est;
  return Math.abs(diff) > Math.max(100, Math.abs(d.total_in) * 0.02) ? diff : null;
}

// ── 外の読み取り役（定期実行のClaude）から届いた結果の検査 ─────────────────

const KINDS: DocKind[] = ["slip", "invoice", "receipt"];
const CATS: CostCategory[] = ["food", "drink", "supplies", "other"];

/**
 * 読み取り役が送ってきた JSON を AiDoc として受け取れるか確かめる。
 * 外から来るものなので、形・種類・金額の範囲を全部見る。だめなら理由を返す。
 */
export function parseAiDoc(v: unknown): { ok: true; doc: AiDoc } | { ok: false; error: string } {
  if (!v || typeof v !== "object") return { ok: false, error: "doc がありません" };
  const o = v as Record<string, unknown>;
  if (!KINDS.includes(o.doc_kind as DocKind)) return { ok: false, error: "doc_kind は slip / invoice / receipt" };
  if (typeof o.vendor !== "string" || !o.vendor.trim()) return { ok: false, error: "vendor が空です" };
  const optDate = (x: unknown) => (x == null || x === "" ? null : typeof x === "string" ? x : undefined);
  const date = optDate(o.date);
  const pf = optDate(o.period_from);
  const pt = optDate(o.period_to);
  if (date === undefined || pf === undefined || pt === undefined) return { ok: false, error: "日付は YYYY-MM-DD の文字列か null" };
  const total = o.total_in == null ? null : Number(o.total_in);
  if (total != null && (!Number.isInteger(total) || Math.abs(total) > 20_000_000)) return { ok: false, error: "total_in が不正です" };
  if (!Array.isArray(o.lines) || o.lines.length === 0 || o.lines.length > 20) return { ok: false, error: "lines は1〜20行" };
  const lines: AiDoc["lines"] = [];
  for (const l of o.lines as Record<string, unknown>[]) {
    if (!l || !CATS.includes(l.category as CostCategory)) return { ok: false, error: "category は food / drink / supplies / other" };
    const amount = Number(l.amount);
    if (!Number.isInteger(amount) || Math.abs(amount) > 10_000_000) return { ok: false, error: "amount は円の整数" };
    if (typeof l.tax_included !== "boolean") return { ok: false, error: "tax_included は true / false" };
    const rate = l.tax_rate == null ? null : Number(l.tax_rate);
    if (rate != null && rate !== 0.08 && rate !== 0.1) return { ok: false, error: "tax_rate は 0.08 / 0.1 / null" };
    lines.push({ category: l.category as CostCategory, amount, tax_included: l.tax_included, tax_rate: rate });
  }
  const note = typeof o.note === "string" ? o.note : "";
  return {
    ok: true,
    doc: { doc_kind: o.doc_kind as DocKind, vendor: o.vendor, date, period_from: pf, period_to: pt, total_in: total, lines, note },
  };
}

// ── ロスの写真の読み取り結果（品名・金額の目安）──────────────────────

export type AiLoss = { item: string; amount_ex: number; reason: LossReason; note: string };

const LOSS_REASONS: LossReason[] = ["expired", "overprep", "mistake", "damaged", "other"];

/**
 * 読み取り役が送ってきたロスの見積もりを受け取れるか確かめる（外から来るので全部見る）。
 * 金額は「仕入値の目安・税抜・円」。調理済みのものは材料の仕入値で見積もる。
 */
export function parseAiLoss(v: unknown): { ok: true; loss: AiLoss } | { ok: false; error: string } {
  if (!v || typeof v !== "object") return { ok: false, error: "loss がありません" };
  const o = v as Record<string, unknown>;
  const item = typeof o.item === "string" ? o.item.trim() : "";
  if (!item || item.length > 60) return { ok: false, error: "item は1〜60文字" };
  const amount = Number(o.amount_ex);
  if (!Number.isInteger(amount) || amount < 0 || amount > 1_000_000) return { ok: false, error: "amount_ex は0〜1,000,000の円の整数" };
  if (!LOSS_REASONS.includes(o.reason as LossReason)) return { ok: false, error: "reason は expired / overprep / mistake / damaged / other" };
  const note = typeof o.note === "string" ? o.note.slice(0, 500) : "";
  return { ok: true, loss: { item, amount_ex: amount, reason: o.reason as LossReason, note } };
}

/** ロスの合計。読み取り待ち（金額がまだ無い）は数えない */
export const lossTotal = (ls: { amount_ex: number | null; status?: PurchaseStatus }[]): number =>
  ls.reduce((a, l) => a + (l.status === "pending" || l.amount_ex == null ? 0 : l.amount_ex), 0);
