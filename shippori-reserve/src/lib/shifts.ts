import { fmtDate, fmtYm, nowJst, shiftMonth } from "@/lib/time";

/** 希望シフトの提出期限：毎月25日まで（対象は翌月分）。店主指定。 */
export const REQUEST_DEADLINE_DAY = 25;

/**
 * いま希望を出せる対象の月（＝翌月）。
 * 営業日（深夜0〜4時は前日扱い）ではなく暦の日付で判定する。
 * DB関数側も暦日で検査するので、月初の深夜にUIとDBで対象月がずれない。
 */
export const requestTargetYm = (): string => fmtYm(shiftMonth(fmtDate(nowJst()), 1));

/** 提出期間中か（今日が25日以前か）。締切の判定は営業日ではなく実際の日付で行う。 */
export const isRequestWindowOpen = (): boolean => nowJst().getDate() <= REQUEST_DEADLINE_DAY;
