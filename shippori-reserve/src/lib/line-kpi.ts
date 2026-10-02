/**
 * LINE友だちの目標（店主要望 2026-08-29、月初リセット方式へ 2026-10-02）。
 *
 * 目標は「毎月、月初の人数を0と置いて、日々の目標を積み上げた数」。
 * 固定の階段（9月末102人…）は友だちが想定より速く増えて1か月で
 * 追い越してしまい、目標として機能しなくなった。月初の実数を基準に
 * 毎月組み直せば、何人になっても「今月あと何人」が常に生きた数字になる。
 */

/**
 * その日のLINE友だち追加の目標人数（店頭声かけの目安・店主指定 2026-08-29）。
 * 平日+2人・金土+3人。休業日（火曜など）は0。
 */
export function lineDailyGoal(dow: number, isClosed: boolean): number {
  if (isClosed) return 0;
  return dow === 5 || dow === 6 ? 3 : 2;
}

export type LineMonthPlan = {
  /** 月の増加目標（＝その月の日々の目標の合計） */
  monthGoal: number;
  /** 今日までに積み上がっているべき目標（ペースの物差し）。月外を見ているときは全日 or 0 */
  goalToDate: number;
};

/**
 * 月の増加目標と、今日時点のペース目標。
 * days は表示中の月の全日（休業日は isClosed）。today は暦の今日。
 */
export function lineMonthPlan(
  days: { date: string; dow: number; isClosed: boolean }[],
  today: string,
): LineMonthPlan {
  let monthGoal = 0;
  let goalToDate = 0;
  for (const d of days) {
    const g = lineDailyGoal(d.dow, d.isClosed);
    monthGoal += g;
    if (d.date <= today) goalToDate += g;
  }
  return { monthGoal, goalToDate };
}
