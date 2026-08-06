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

/**
 * 一日の切れ目。深夜4時。
 *
 * この施設が動くのは夜で、卓は翌1時2時まで続くことが多い。
 * 0時で切ると「20:00〜翌1:00」の一晩がカレンダー上で2日に割れて、
 * ひと晩の開催が2件あるように見える。4時で切れば、ふつうの夜は
 * まるごと1つの列に収まる。4:00〜27:59 を「その日」として扱う。
 */
export const DAY_START_HOUR = 4;

/** その「日」の範囲（4:00〜翌4:00）をミリ秒で返す */
export const dayWindow = (date: string): [number, number] => [
  new Date(jstHourToIso(date, DAY_START_HOUR)).getTime(),
  new Date(jstHourToIso(date, DAY_START_HOUR + 24)).getTime(),
];

/** その時刻が属する「日」。4時より前は前日の夜として扱う。 */
export const nightOf = (iso: string | Date): string =>
  fmtDate(new Date(new Date(iso).getTime() - DAY_START_HOUR * 3600_000));

/** カレンダーの時刻表記。24時を超えたぶんは 24:00〜27:00 として出す。 */
export const clockLabel = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

export const WEEKDAYS_JA = ["月", "火", "水", "木", "金", "土", "日"];

/** ISO → JST の時（0..23） */
export const jstHour = (iso: string): number => toJst(iso).getHours();

/** 予約の終了時刻を、開始日の 1..24 時として返す（翌0時は 24） */
export const jstEndHourOnStartDate = (startIso: string, endIso: string): number => {
  const h = jstHour(endIso);
  return fmtDate(startIso) === fmtDate(endIso) ? h : h === 0 ? 24 : h + 24;
};
