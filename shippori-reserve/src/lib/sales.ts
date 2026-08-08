/** 日毎の売上（目標と実績）。実績はエアレジ→週次レポート経由で流し込む。 */
export type SalesDay = {
  biz_date: string;
  target_yen: number | null;
  actual_yen: number | null;
};

/** 58,000 → 「5.8万」。カレンダーの行に収まる短さで出す。 */
export const fmtMan = (yen: number): string => {
  if (yen >= 10000) {
    const man = Math.round(yen / 1000) / 10;
    return `${Number.isInteger(man) ? man.toFixed(0) : man}万`;
  }
  return `${yen.toLocaleString()}円`;
};

/** 3桁区切りの円表記 */
export const fmtYen = (yen: number): string => `¥${yen.toLocaleString()}`;
