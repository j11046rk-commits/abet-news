/**
 * 3ヶ月ゲート（HANDOFF §6）。
 * 思想: データは絶対に消さない。メーター（bb/100・ROI・実収支トータル）は
 * 全期間データで計算した最新値を無料でも常に全部見せる。
 * 無料で "閉じる" のは「3ヶ月より前の明細の閲覧」と「深掘り分析」だけ。
 * 課金は "過去が開く" 体験。
 */

export const FREE_WINDOW_DAYS = 90;

/** 無料で明細を閲覧できる下限のepoch ms（これより古いはロック）。 */
export function freeCutoff(nowMs: number): number {
  return nowMs - FREE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/** 無料ユーザーに見せてよい明細か。Proは常にtrue。 */
export function isVisibleFree(itemDateMs: number, nowMs: number): boolean {
  return itemDateMs >= freeCutoff(nowMs);
}

/**
 * 明細配列を「無料で見える分」と「ロックされた古い分の件数」に分割。
 * items は日付降順である前提。
 */
export function partitionByGate<T extends { date: number }>(
  items: readonly T[],
  isPro: boolean,
  nowMs: number,
): { visible: T[]; lockedCount: number } {
  if (isPro) return { visible: [...items], lockedCount: 0 };
  const cutoff = freeCutoff(nowMs);
  const visible: T[] = [];
  let lockedCount = 0;
  for (const it of items) {
    if (it.date >= cutoff) visible.push(it);
    else lockedCount += 1;
  }
  return { visible, lockedCount };
}
