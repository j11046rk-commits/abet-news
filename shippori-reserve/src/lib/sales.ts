/** 日毎の売上（目標と実績）。実績はエアレジ→週次レポート経由で流し込む。 */
export type SalesDay = {
  biz_date: string;
  target_yen: number | null;
  actual_yen: number | null;
};

/** 3桁区切りの円表記。金額は省略せず1円単位で出す（店主指定）。 */
export const fmtYen = (yen: number): string => `¥${yen.toLocaleString()}`;
