/**
 * 原価（仕入・棚卸・ロス）の計算。DBにも画面にも依存しない純粋な関数だけを置く。
 *
 * 原価率 ＝（月初の在庫 ＋ その月の仕入 − 月末の在庫）÷ その月の売上
 *
 * - 仕入も売上も**税抜**で比べる（税理士の月次報告と同じ物差し）。
 *   食材は8%、売上（店内）は10%なので、税込どうしで割ると約2ポイント低く出てしまう。
 * - 原価に入れるのは 食材＋酒・飲料。消耗品は別に出す（8月の報告で消耗品費が跳ねていたため、
 *   「消耗品込み」も並べて見せる）。
 * - 棚卸が無い月は「原価率」は出さない。仕入÷売上（仕入率）を目安としてだけ出す。
 *   在庫の増減を無視した数字を原価率と呼ぶと、仕入が多い月に間違った警報を鳴らすことになる。
 */
import type { SalesDay } from "./sales.ts";

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

export type Purchase = {
  id: string;
  book_date: string;
  vendor: string;
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

export type Stocktake = { ym: string; status: "draft" | "done"; total_ex: number | null };

export type MonthCost = {
  salesEx: number | null;
  /** 売上の入っていない営業日がある（月の途中・取り込み待ち） */
  salesDays: number;
  food: number;
  drink: number;
  supplies: number;
  other: number;
  /** 原価に入れる仕入（食材＋酒・飲料） */
  cogsPurchase: number;
  openStock: number | null;
  closeStock: number | null;
  /** 売上原価（月初在庫＋仕入−月末在庫）。棚卸が両方そろったときだけ */
  cogs: number | null;
  /** 原価率（%・小数第1位）。棚卸が両方そろい、売上があるときだけ */
  ratio: number | null;
  /** 消耗品込みの率（%）。原価率と同じ条件 */
  ratioWithSupplies: number | null;
  /** 仕入率（仕入÷売上・%）。棚卸が無くても出る目安 */
  purchaseRatio: number | null;
  /** 原価率が出ない理由（画面にそのまま出す） */
  missing: string[];
  loss: number;
};

const pct = (num: number, den: number | null): number | null =>
  den != null && den > 0 ? Math.round((num / den) * 1000) / 10 : null;

export function monthCost(input: {
  sales: (SalesDay | null | undefined)[];
  purchases: Purchase[];
  open: Stocktake | null;
  close: Stocktake | null;
  lossEx?: number;
}): MonthCost {
  let salesEx: number | null = null;
  let salesDays = 0;
  for (const s of input.sales) {
    const v = salesExTax(s);
    if (v == null) continue;
    salesEx = (salesEx ?? 0) + v;
    salesDays += 1;
  }
  const sum = (k: "food_ex" | "drink_ex" | "supplies_ex" | "other_ex") =>
    input.purchases.reduce((a, p) => a + p[k], 0);
  const food = sum("food_ex");
  const drink = sum("drink_ex");
  const supplies = sum("supplies_ex");
  const other = sum("other_ex");
  const cogsPurchase = food + drink;

  const openStock = input.open?.status === "done" ? input.open.total_ex : null;
  const closeStock = input.close?.status === "done" ? input.close.total_ex : null;

  const missing: string[] = [];
  if (openStock == null) missing.push("月初の在庫（前の月の棚卸）");
  if (closeStock == null) missing.push("月末の棚卸");
  if (salesEx == null) missing.push("売上");

  const cogs = openStock != null && closeStock != null ? openStock + cogsPurchase - closeStock : null;

  return {
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
    loss: input.lossEx ?? 0,
  };
}

/** 棚卸の在庫額。空欄（数えていない品）は足さない */
export function stockTotal(counts: { qty: number | null; unit_price: number }[]): number {
  return Math.round(counts.reduce((a, c) => a + (c.qty != null ? c.qty * c.unit_price : 0), 0));
}

/** 前の月（YYYY-MM） */
export function prevYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
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
