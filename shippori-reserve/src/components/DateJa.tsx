import { holidayName } from "@/lib/holidays";
import { fmt, WEEKDAY_JA, weekdayOf } from "@/lib/time";

/**
 * 日付＋曜日の表示。曜日の文字色は 土曜＝青・日曜と祝日＝赤（店主指定）。
 * ヘッダーや一覧の見出しなど、日付を文字列で出す場所はこれを使う。
 */
export default function DateJa({ date, long = false }: { date: string; long?: boolean }) {
  const dow = weekdayOf(date);
  const holiday = holidayName(date);
  const cls = holiday || dow === 0 ? "dow-red" : dow === 6 ? "dow-blue" : "";
  return (
    <>
      {fmt(date, long ? "M月d日" : "M/d")}(<span className={cls || undefined}>{WEEKDAY_JA[dow]}</span>)
    </>
  );
}
