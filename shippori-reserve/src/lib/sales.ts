/** 日毎の売上（目標と実績）。実績はエアレジ→週次レポート経由で流し込む。 */
export type SalesDay = {
  biz_date: string;
  target_yen: number | null;
  actual_yen: number | null;
  /** 消費税8%（＝持ち帰り＝物販）の売上。未取得は null */
  tax8_yen: number | null;
  /** 消費税10%（＝店内飲食）の売上。エアレジの税率別からのみ入る */
  tax10_yen: number | null;
};

/** 3桁区切りの円表記。金額は省略せず1円単位で出す（店主指定）。 */
export const fmtYen = (yen: number): string => `¥${yen.toLocaleString()}`;

/**
 * 店内飲食だけの売上。物販（太巻きなど）を抜いた「店の実力」を見るための数字。
 * 10%が分かっていればそれを、無ければ「実績 − 物販」を使う。
 * DBの v_sales_day.dine_in_yen と同じ計算。
 */
export const dineInYen = (s: {
  actual_yen: number | null;
  tax8_yen: number | null;
  tax10_yen: number | null;
}): number | null => {
  if (s.tax10_yen != null) return s.tax10_yen;
  if (s.actual_yen == null) return null;
  return s.actual_yen - (s.tax8_yen ?? 0);
};
