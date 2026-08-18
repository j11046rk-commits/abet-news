/** 日毎の売上（目標と実績）。実績はエアレジ→週次レポート経由で流し込む。 */
export type SalesDay = {
  biz_date: string;
  target_yen: number | null;
  actual_yen: number | null;
  /** 消費税8%（＝持ち帰り＝物販）の売上。未取得は null */
  tax8_yen: number | null;
  /** 消費税10%（＝店内飲食）の売上。エアレジの税率別からのみ入る */
  tax10_yen: number | null;
  /** 客数（エアレジ）。未取得の日は null */
  guest_count?: number | null;
  /** 会計数＝伝票の枚数（おおよその組数）。未取得の日は null */
  check_count?: number | null;
};

/** 3桁区切りの円表記。金額は省略せず1円単位で出す（店主指定）。 */
export const fmtYen = (yen: number): string => `¥${yen.toLocaleString()}`;

/**
 * 1日の売上を「店内・物販・合計」に読み替えたもの。
 *
 * 店主の指示（2026-08）:
 *   物販は日毎の売上からは外す。ただし月間の売上目標には計上する。
 *
 * つまり画面は2つの物差しを持つ。
 *   日毎の表示と達成判定 … dineIn（店内だけ）
 *   月間の合計と目標判定 … total（物販込み）
 *
 * 太巻きの日のように1日で62万の物販が乗ると、その日は通常営業の5日分になり、
 * 平均も達成率も連続記録も全部そこに引きずられる。日毎を店内だけで見れば、
 * 店の地力はそのまま読めて、稼いだ金は月間にちゃんと乗る。
 *
 * 画面には「店内」「物販」「合計」が並ぶので、**足し算が必ず合う**ことが要る。
 * だから店内は「合計 − 物販」で出す。エアレジの10%は、実績が無い日の予備。
 * （10%を優先すると、商品券や0%対象がある日に 店内＋物販 ≠ 合計 になる）
 */
export type SalesView = {
  target: number | null;
  /** 店内の売上（＝合計 − 物販）。分からない日は null */
  dineIn: number | null;
  /** 物販の売上。無い日は 0 */
  retail: number;
  /** その日の合計（店内＋物販）。月間に積むのはこれ */
  total: number | null;
};

export const salesView = (s: SalesDay | null | undefined): SalesView => {
  if (!s) return { target: null, dineIn: null, retail: 0, total: null };

  const retail = s.tax8_yen ?? 0;
  // 合計はレジの総額が正。税率別しか無い日だけ、その足し算で代用する。
  const total =
    s.actual_yen ??
    (s.tax10_yen != null || s.tax8_yen != null ? (s.tax10_yen ?? 0) + (s.tax8_yen ?? 0) : null);
  const dineIn = s.actual_yen != null ? s.actual_yen - retail : (s.tax10_yen ?? null);

  return { target: s.target_yen ?? null, dineIn, retail, total };
};

/**
 * その日が目標を達成したか。日毎の判定なので店内だけを見る。
 *
 * 金色に光るセル・カレンダーの行・お祝いバナー・連続達成・達成貢献⭐は
 * すべてこの1つの式を通す。同じ日について画面ごとに答えが違う、を作らないため。
 *
 * target が 0 の日（火曜定休に0を入れてある）は判定しない。
 * 0円以上なら必ず達成になってしまい、休業日に物販が乗った日が金色に光る。
 */
export const hitOf = (d: { target: number | null; dineIn: number | null }): boolean =>
  d.target != null && d.target > 0 && d.dineIn != null && d.dineIn >= d.target;

/** 表示してよい金額か。実績を後から物販より小さく直すと店内が負になる。 */
export const shownYen = (yen: number | null): number | null => (yen != null && yen >= 0 ? yen : null);

/**
 * 客単価（1名あたりの売上）。
 *
 * 割り算は保存しない。客数と売上という事実から、見るときに毎回出す。
 * 保存した平均は、あとで実績を直したときに置いていかれて必ず食い違う。
 *
 * 分母の客数には**お持ち帰りだけのお客様も入っている**（エアレジの客数がそう数える）。
 * だから太巻きの日を含む月は、合計で割ると高く、店内で割ると低く出る。
 * どちらも嘘ではないので、物販がある月は画面に両方出して、どちらの数字か明示する。
 * 見出しに出すのは「合計 ÷ 客数」——エアレジの画面に出ている数字と揃えるため。
 */
export const perGuest = (yen: number | null, guests: number | null): number | null =>
  yen != null && guests != null && guests > 0 ? Math.round(yen / guests) : null;

/** 1組あたりの人数（客数 ÷ 会計数）。小数第1位まで */
export const guestsPerCheck = (guests: number | null, checks: number | null): number | null =>
  guests != null && checks != null && checks > 0 ? Math.round((guests / checks) * 10) / 10 : null;
