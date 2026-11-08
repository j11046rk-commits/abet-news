/**
 * 店舗評価（店主指定 2026-11-09）。店長個人ではなく「店の成績」として全員が見る。
 * 3つの物差しの達成率から点数とランクを出す。純粋な関数だけ（node --test で回す）。
 *
 *   売上   … 売上（物販込み）÷ 目標。月の途中は「売上が入っている日までの目標」と比べる
 *   人件費 … 人件費率。アプリは給与を読まない（店主指示 2026-11-02）ので、人時売上から推定する
 *            推定人件費率 ＝ 1時間あたりの人件費の目安 ÷ 人時売上
 *            （人時売上5,000円＝人件費率25%・店主決定 2026-11-02 → 目安は1,250円/時）
 *            達成率 ＝ 目標の率 ÷ 推定の率（低いほど良いので逆数）
 *   原価   … 原価率（棚卸の間ごと・lib/cost）。達成率 ＝ 目標 ÷ 実際
 *
 * 点数 ＝ 達成率（上限120%）の重みつき平均（売上40・人件費30・原価30。出せない物差しは外して割り直す）
 * ランク：S 105点以上／A 100〜／B 95〜／C 90〜／D 90未満
 */

export type EvalTargets = {
  /** 人件費率の目標（%） */
  laborRatio: number;
  /** 1時間あたりの人件費の目安（円）。推定人件費率の分子 */
  hourCost: number;
  /** 原価率の目標（%）。未設定なら原価は点数に入れない */
  costRatio: number | null;
};

export const DEFAULT_TARGETS: EvalTargets = { laborRatio: 25, hourCost: 1250, costRatio: null };

export type MetricKey = "sales" | "labor" | "cost";
export const METRIC_WEIGHT: Record<MetricKey, number> = { sales: 40, labor: 30, cost: 30 };
export const RATE_CAP = 120;

export type Rank = "S" | "A" | "B" | "C" | "D";
export const rankOf = (score: number): Rank => (score >= 105 ? "S" : score >= 100 ? "A" : score >= 95 ? "B" : score >= 90 ? "C" : "D");

export type Metric = {
  key: MetricKey;
  label: string;
  /** 達成率（%・小数第1位）。出せなければ null */
  rate: number | null;
  /** 実際（表示用） */
  actual: string;
  /** 目標（表示用） */
  target: string;
  /** 出せない理由・補足 */
  note: string | null;
};

export type EvalInput = {
  /** 売上（物販込み）と、それに対応する目標（月の途中は売上が入っている日までの目標） */
  sales: { actual: number | null; target: number | null };
  /** 人時売上の材料：労働時間が取り込めた日の店内売上と、その日の労働時間（分） */
  labor: { sales: number; minutes: number };
  /** 原価率（%）と、どの期間のものか */
  cost: { ratio: number | null; span: string | null };
  targets: EvalTargets;
};

export type EvalResult = { metrics: Metric[]; score: number | null; rank: Rank | null };

const r1 = (n: number) => Math.round(n * 10) / 10;
const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;

export function storeEval(i: EvalInput): EvalResult {
  const metrics: Metric[] = [];

  const sa = i.sales;
  metrics.push({
    key: "sales",
    label: "売上",
    rate: sa.actual != null && sa.target != null && sa.target > 0 ? r1((sa.actual / sa.target) * 100) : null,
    actual: sa.actual != null ? yen(sa.actual) : "—",
    target: sa.target != null ? yen(sa.target) : "—",
    note: sa.target == null || sa.target <= 0 ? "目標が入っていません" : sa.actual == null ? "売上がまだ入っていません" : null,
  });

  const perHour = i.labor.minutes > 0 ? i.labor.sales / (i.labor.minutes / 60) : null;
  const est = perHour != null && perHour > 0 ? (i.targets.hourCost / perHour) * 100 : null;
  metrics.push({
    key: "labor",
    label: "人件費率",
    rate: est != null ? r1((i.targets.laborRatio / est) * 100) : null,
    actual: est != null ? `${r1(est)}%（人時売上 ${yen(perHour!)}）` : "—",
    target: `${i.targets.laborRatio}%以下`,
    note: est == null ? "労働時間がまだ取り込めていません" : "人時売上からの推定",
  });

  const c = i.cost;
  const ct = i.targets.costRatio;
  metrics.push({
    key: "cost",
    label: "原価率",
    rate: c.ratio != null && c.ratio > 0 && ct != null ? r1((ct / c.ratio) * 100) : null,
    actual: c.ratio != null ? `${c.ratio}%` : "—",
    target: ct != null ? `${ct}%以下` : "未設定",
    note: ct == null ? "目標が未設定" : c.ratio == null ? "棚卸が2回そろうと出ます" : c.span ? `${c.span}の棚卸から` : null,
  });

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
