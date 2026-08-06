/**
 * タイムゾーンは Asia/Tokyo 固定（SPEC §6）。
 * DB は timestamptz で保存し、表示と入力の解釈をここに集約する。
 */
import { TZDate } from "@date-fns/tz";
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ja } from "date-fns/locale";

export const TZ = "Asia/Tokyo";

/** UTC の Date / ISO 文字列を JST の壁時計として扱える Date に変換 */
export const toJst = (d: Date | string): TZDate =>
  new TZDate(typeof d === "string" ? new Date(d) : d, TZ);

/** JST の「今」 */
export const nowJst = (): TZDate => new TZDate(new Date(), TZ);

/**
 * JST の壁時計（YYYY-MM-DD, HH）から UTC の ISO 文字列を作る。
 * hour は 0..24（24 は翌日 0時）。予約は1時間単位なので分秒は常に 0。
 */
export const jstHourToIso = (dateStr: string, hour: number): string => {
  const [y, m, d] = dateStr.split("-").map(Number);
  const base = new TZDate(y, m - 1, d, 0, 0, 0, 0, TZ);
  return new Date(base.getTime() + hour * 3600_000).toISOString();
};

/** JST の壁時計（YYYY-MM-DD, HH:mm）から UTC の ISO 文字列 */
export const jstToIso = (dateStr: string, timeStr: string): string => {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return new TZDate(y, m - 1, d, hh, mm ?? 0, 0, 0, TZ).toISOString();
};

export const fmt = (d: Date | string, pattern: string): string =>
  format(toJst(d), pattern, { locale: ja });

/** 2026-08-06 */
export const fmtDate = (d: Date | string) => fmt(d, "yyyy-MM-dd");
/** 8月6日(木) */
export const fmtDateJa = (d: Date | string) => fmt(d, "M月d日(E)");
/** 20:00 */
export const fmtTime = (d: Date | string) => fmt(d, "HH:mm");
/** 8月6日(木) 20:00 */
export const fmtDateTimeJa = (d: Date | string) => fmt(d, "M月d日(E) HH:mm");
/** 2026-08 */
export const fmtYm = (d: Date | string) => fmt(d, "yyyy-MM");

export const startOfMonthJst = (d: Date | string = nowJst()) => startOfMonth(toJst(d));
export const endOfMonthJst = (d: Date | string = nowJst()) => endOfMonth(toJst(d));
export const startOfWeekJst = (d: Date | string = nowJst()) =>
  startOfWeek(toJst(d), { weekStartsOn: 1 });

export const addDaysJst = (d: Date | string, n: number) => addDays(toJst(d), n);
export const addMonthsJst = (d: Date | string, n: number) => addMonths(toJst(d), n);

/** 今月の残り日数（今日を含む） */
export const daysLeftInMonth = (from: Date = nowJst()): number =>
  differenceInCalendarDays(endOfMonthJst(from), toJst(from)) + 1;

/** 予約の実時間（時間・小数第1位） */
export const durationHours = (startsAt: string, endsAt: string): number =>
  Math.round(((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 3600_000) * 10) / 10;

/** 24時間ぶんの選択肢。end=true のとき 24:00 まで含める */
export const hourOptions = (end = false): { value: number; label: string }[] =>
  Array.from({ length: end ? 24 : 24 }, (_, i) => {
    const h = end ? i + 1 : i;
    return { value: h, label: `${String(h).padStart(2, "0")}:00` };
  });

/** ISO 文字列 → JST の 0..24 時（日をまたぐ終了は 24 として返せるよう baseDate を渡す） */
export const jstHourOf = (iso: string, baseDate?: string): number => {
  const d = toJst(iso);
  const h = d.getHours();
  if (baseDate && fmtDate(iso) !== baseDate) return h === 0 ? 24 : h + 24;
  return h;
};

export const WEEKDAYS_JA = ["月", "火", "水", "木", "金", "土", "日"];
