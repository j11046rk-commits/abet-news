/**
 * 店舗評価（店主指定 2026-11-09）。店長個人ではなく「店の成績」として全員が見る。
 * 3つの物差しの達成率から点数とランクを出す。純粋な関数だけ（node --test で回す）。
 *
 *   売上   … 売上（物販込み）÷ 目標。月の途中は「売上が入っている日までの目標」と比べる
 *   人件費 … 人件費率 ＝ 月の人件費の合計 ÷ 税抜売上（店主指示 2026-11-09「実際の人件費率を」）。
 *            合計は店全体の1つの数字だけ（labor_cost_monthly・個人の額は持たない）。
 *            まだ合計が無い月（今月など）は推定：1時間あたりの人件費（直近の実績の月の 合計÷労働時間、
 *            実績が無ければ設定の目安）× その月の労働時間 ÷ 税抜売上
 *            達成率 ＝ 目標の率 ÷ 実際（または推定）の率（低いほど良いので逆数）
 *   原価   … 原価率（棚卸の間ごと・lib/cost）。達成率 ＝ 目標 ÷ 実際
 *
 *   LINE友だち … その月の増加 ÷ 月の友だち目標（売上タブのKPI。月の途中は今日までの目標）
 *   人時売上 … 店内売上 ÷ 労働時間 ÷ 目標（5,000円）
 *
 * 点数 ＝ 達成率（上限120%）の重みつき平均。重み（店主決定 2026-11-09）：
 *   売上40・原価率25・人件費率20・LINE友だちの増加10・人時売上5（出せない物差しは外して割り直す）
 * ランク：S 105点以上／A 100〜／B 95〜／C 90〜／D 90未満
 */

export type EvalTargets = {
  /** 人件費率の目標（%） */
  laborRatio: number;
  /** 1時間あたりの人件費の目安（円）。実績の月が1つも無いときだけ推定に使う */
  hourCost: number;
  /** 原価率の目標（%）。未設定なら原価は点数に入れない */
  costRatio: number | null;
};

export const DEFAULT_TARGETS: EvalTargets = { laborRatio: 25, hourCost: 1250, costRatio: null };

export type MetricKey = "sales" | "cost" | "labor" | "line" | "perhour";
export const METRIC_WEIGHT: Record<MetricKey, number> = { sales: 40, cost: 25, labor: 20, line: 10, perhour: 5 };
/** 人時売上の目標（円/時・店主決定 2026-11-02） */
export const PER_HOUR_TARGET = 5000;
export const RATE_CAP = 120;

export type Rank = "S" | "A" | "B" | "C" | "D";
export const rankOf = (score: number): Rank => (score >= 105 ? "S" : score >= 100 ? "A" : score >= 95 ? "B" : score >= 90 ? "C" : "D");

export type Metric = {
  key: MetricKey;
  label: string;
  /** 達成率（%・小数第1位）。出せなければ null。画面では「点」（目標どおり＝100点・上限120点）として出す */
  rate: number | null;
  /** 実際（表示用）。人件費率・原価率は率そのもの（%）、売上は金額 */
  actual: string;
  /** 目標（表示用） */
  target: string;
  /** 目標との差（表示用）。例：「目標より2.3%高い」「あと12,000円」 */
  gap: string | null;
  /** 目標を満たしているか */
  good: boolean | null;
  /** 出せない理由・補足 */
  note: string | null;
};

export type EvalInput = {
  /** 売上（物販込み）と、それに対応する目標（月の途中は売上が入っている日までの目標） */
  sales: { actual: number | null; target: number | null };
  /**
   * 人件費率の材料。cost：その月の人件費（実績の合計、または推定）、salesEx：同じ期間の税抜売上、
   * estimated：推定か、basis：推定の根拠（表示用）
   */
  labor: { cost: number | null; salesEx: number | null; estimated: boolean; basis: string | null };
  /** 原価率（%）と、どの期間のものか */
  cost: { ratio: number | null; span: string | null };
  /** LINE友だちの増加と、その目標（月の途中は今日までの目標） */
  line?: { gain: number | null; goal: number | null };
  /** 人時売上の材料：労働時間が取り込めた日の店内売上と労働時間（分） */
  perHour?: { sales: number; minutes: number };
  targets: EvalTargets;
};

export type EvalResult = { metrics: Metric[]; score: number | null; rank: Rank | null };

const r1 = (n: number) => Math.round(n * 10) / 10;
const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;

/** 率（低いほど良い）と目標の差を言葉で。「2.3%」は率どうしの差（ポイント差） */
const ratioGap = (actual: number, target: number): string => {
  const d = r1(actual - target);
  return d > 0 ? `目標より${d}%高い` : d < 0 ? `目標より${-d}%低い` : "目標どおり";
};

/** 達成率 → 画面に出す点（整数・上限120） */
export const pointsOf = (rate: number | null): number | null => (rate == null ? null : Math.round(Math.min(rate, RATE_CAP)));

export function storeEval(i: EvalInput): EvalResult {
  const metrics: Metric[] = [];

  const sa = i.sales;
  metrics.push({
    key: "sales",
    label: "売上",
    rate: sa.actual != null && sa.target != null && sa.target > 0 ? r1((sa.actual / sa.target) * 100) : null,
    actual: sa.actual != null ? yen(sa.actual) : "—",
    target: sa.target != null ? yen(sa.target) : "—",
    gap:
      sa.actual != null && sa.target != null && sa.target > 0
        ? sa.actual >= sa.target
          ? `目標より＋${yen(sa.actual - sa.target)}`
          : `目標まであと${yen(sa.target - sa.actual)}`
        : null,
    good: sa.actual != null && sa.target != null && sa.target > 0 ? sa.actual >= sa.target : null,
    note: sa.target == null || sa.target <= 0 ? "目標が入っていません" : sa.actual == null ? "売上がまだ入っていません" : null,
  });

  const lb = i.labor;
  const lr = lb.cost != null && lb.salesEx != null && lb.salesEx > 0 ? (lb.cost / lb.salesEx) * 100 : null;
  metrics.push({
    key: "labor",
    label: "人件費率",
    rate: lr != null && lr > 0 ? r1((i.targets.laborRatio / lr) * 100) : null,
    actual: lr != null ? `${r1(lr)}%${lb.estimated ? "（推定）" : ""}` : "—",
    target: `${i.targets.laborRatio}%以下`,
    gap: lr != null ? ratioGap(r1(lr), i.targets.laborRatio) : null,
    good: lr != null ? r1(lr) <= i.targets.laborRatio : null,
    note: lr == null ? (lb.estimated ? "労働時間がまだ取り込めていません" : "売上がまだ入っていません") : lb.estimated ? lb.basis : "月の人件費の合計から",
  });

  const c = i.cost;
  const ct = i.targets.costRatio;
  metrics.push({
    key: "cost",
    label: "原価率",
    rate: c.ratio != null && c.ratio > 0 && ct != null ? r1((ct / c.ratio) * 100) : null,
    actual: c.ratio != null ? `${c.ratio}%` : "—",
    target: ct != null ? `${ct}%以下` : "未設定",
    gap: c.ratio != null && ct != null ? ratioGap(c.ratio, ct) : null,
    good: c.ratio != null && ct != null ? c.ratio <= ct : null,
    note: ct == null ? "目標が未設定" : c.ratio == null ? "棚卸が2回そろうと出ます" : c.span ? `${c.span}の棚卸から` : null,
  });

  const ln = i.line;
  if (ln) {
    const ok = ln.gain != null && ln.goal != null && ln.goal > 0;
    metrics.push({
      key: "line",
      label: "LINE友だちの増加",
      rate: ok ? r1((Math.max(0, ln.gain!) / ln.goal!) * 100) : null,
      actual: ln.gain != null ? `${ln.gain >= 0 ? "+" : ""}${ln.gain}人` : "—",
      target: ln.goal != null ? `+${ln.goal}人` : "—",
      gap: ok ? (ln.gain! >= ln.goal! ? `目標より＋${ln.gain! - ln.goal!}人` : `目標まであと${ln.goal! - ln.gain!}人`) : null,
      good: ok ? ln.gain! >= ln.goal! : null,
      note: ln.gain == null ? "友だちの数がまだ届いていません" : null,
    });
  }

  const ph = i.perHour;
  if (ph) {
    const v = ph.minutes > 0 ? Math.round(ph.sales / (ph.minutes / 60)) : null;
    metrics.push({
      key: "perhour",
      label: "人時売上",
      rate: v != null ? r1((v / PER_HOUR_TARGET) * 100) : null,
      actual: v != null ? yen(v) : "—",
      target: `${yen(PER_HOUR_TARGET)}以上`,
      gap: v != null ? (v >= PER_HOUR_TARGET ? `目標より＋${yen(v - PER_HOUR_TARGET)}` : `目標まであと${yen(PER_HOUR_TARGET - v)}`) : null,
      good: v != null ? v >= PER_HOUR_TARGET : null,
      note: v == null ? "労働時間がまだ取り込めていません" : "1時間あたりの店内売上",
    });
  }

  // 並びは重みの順（売上・原価・人件費・LINE・人時売上）
  const order: MetricKey[] = ["sales", "cost", "labor", "line", "perhour"];
  metrics.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

  let num = 0;
  let den = 0;
  for (const m of metrics) {
    if (m.rate == null) continue;
    num += Math.min(m.rate, RATE_CAP) * METRIC_WEIGHT[m.key];
    den += METRIC_WEIGHT[m.key];
  }
  const score = den > 0 ? r1(num / den) : null;
  return { metrics, score, rank: score != null ? rankOf(score) : null };
}

/**
 * 人件費の推定。実績の合計がある月はそのまま、無い月は「1時間あたりの人件費 × 労働時間」。
 * 1時間あたりの人件費は、直近の実績の月（合計 ÷ その月の労働時間）。無ければ設定の目安。
 */
export function laborCostFor(input: {
  actualTotal: number | null;
  minutes: number;
  calib: { ym: string; total: number; minutes: number } | null;
  fallbackHourCost: number;
}): { cost: number | null; estimated: boolean; basis: string | null } {
  if (input.actualTotal != null) return { cost: input.actualTotal, estimated: false, basis: null };
  if (input.minutes <= 0) return { cost: null, estimated: true, basis: null };
  const c = input.calib && input.calib.minutes > 0 ? input.calib : null;
  const perHour = c ? c.total / (c.minutes / 60) : input.fallbackHourCost;
  const basis = c
    ? `${Number(c.ym.slice(5))}月の実績 1時間あたり${Math.round(perHour).toLocaleString("ja-JP")}円 × 労働時間で推定`
    : `1時間あたり${Math.round(perHour).toLocaleString("ja-JP")}円（目安）× 労働時間で推定`;
  return { cost: Math.round(perHour * (input.minutes / 60)), estimated: true, basis };
}

/** settings の値から目標を読む（壊れた値は既定に戻す） */
export function targetsFrom(settings: Record<string, unknown>): EvalTargets {
  const num = (v: unknown, lo: number, hi: number): number | null => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
  };
  return {
    laborRatio: num(settings.eval_labor_ratio, 5, 60) ?? DEFAULT_TARGETS.laborRatio,
    hourCost: num(settings.eval_hour_cost, 500, 5000) ?? DEFAULT_TARGETS.hourCost,
    costRatio: num(settings.eval_cost_ratio, 5, 80),
  };
}

// ── 達成貢献⭐（売上目標を達成した日に、確定シフトで出勤していた人に1つ）────────────

/**
 * 累計の⭐。シフトを確定した月だけ数える（売上タブの月ごとの⭐と同じ決め方）。
 * hitDates：達成した日（lib/sales の hitOf で判定済み）、shifts：日付→出勤した人、published：確定した月（YYYY-MM）
 */
export function starsEarned(hitDates: Iterable<string>, shifts: Map<string, string[]>, published: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of hitDates) {
    if (!published.has(d.slice(0, 7))) continue;
    for (const id of shifts.get(d) ?? []) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

/** 交換に使う⭐の数 */
export const STARS_PER_EXCHANGE = 100;

/** 使える⭐＝累計 − 交換済み − 申請中 */
export const starsAvailable = (earned: number, used: number, requested: number): number => Math.max(0, earned - used - requested);
