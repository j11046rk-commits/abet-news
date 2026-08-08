import { fmtYm, nowJst, shiftMonth, todayBizDate } from "@/lib/time";

/** 希望シフトの提出期限：毎月25日まで（対象は翌月分）。店主指定。 */
export const REQUEST_DEADLINE_DAY = 25;

/** いま希望を出せる対象の月（＝翌月） */
export const requestTargetYm = (): string => fmtYm(shiftMonth(todayBizDate(), 1));

/** 提出期間中か（今日が25日以前か）。締切の判定は営業日ではなく実際の日付で行う。 */
export const isRequestWindowOpen = (): boolean => nowJst().getDate() <= REQUEST_DEADLINE_DAY;
