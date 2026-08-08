import { redirect } from "next/navigation";
import { todayBizDate } from "@/lib/time";

export const dynamic = "force-dynamic";

/** 下タブの「今日」。今日の営業日（深夜0〜4時は前日の営業）の日別画面へ。 */
export default function TodayPage() {
  redirect(`/day/${todayBizDate()}`);
}
