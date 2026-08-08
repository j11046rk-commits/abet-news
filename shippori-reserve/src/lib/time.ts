/**
 * 時刻の扱い。タイムゾーンは Asia/Tokyo 固定。
 *
 * この店は 18:00〜25:00 で、24時をまたぐ。
 * 「8月15日 24:30 の予約」はカレンダー上は8月16日だが、店にとっては8月15日の営業である。
 *
 * そこで：
 *   - DB には timestamptz（絶対時刻）で保存する
 *   - 「どの営業日か」は biz_date 列で明示的に持つ（時刻から計算しない）
 *   - 時刻は「その営業日の 0:00 からの経過分」（open_min / close_min と同じ物差し）で扱う
 *     18:00 = 1080 ／ 24:00 = 1440 ／ 25:00 = 1500
 *
 * この物差しに寄せておくと、日付の境界で数字がズレる定番の事故が起きない。
 */
import { TZDate } from "@date-fns/tz";
import { addDays, addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import { ja } from "date-fns/locale";

export const TZ = "Asia/Tokyo";

export const toJst = (d: Date | string): TZDate =>
  new TZDate(typeof d === "string" ? new Date(d) : d, TZ);

export const nowJst = (): TZDate => new TZDate(new Date(), TZ);

export const fmt = (d: Date | string, pattern: string): string =>
  format(toJst(d), pattern, { locale: ja });

/** 2026-08-08 */
export const fmtDate = (d: Date | string) => fmt(d, "yyyy-MM-dd");
/** 8月8日(土) */
export const fmtDateJa = (d: Date | string) => fmt(d, "M月d日(E)");
/** 8/8(土) */
export const fmtDateShort = (d: Date | string) => fmt(d, "M/d(E)");
/** 2026年8月 */
export const fmtMonthJa = (d: Date | string) => fmt(d, "yyyy年M月");
/** 2026-08 */
export const fmtYm = (d: Date | string) => fmt(d, "yyyy-MM");

/** 今日の営業日（YYYY-MM-DD）。深夜0〜4時は前日の営業として扱う。 */
export const todayBizDate = (): string => {
  const n = nowJst();
  return fmtDate(n.getHours() < 4 ? addDays(n, -1) : n);
};

/** YYYY-MM-DD を n 日ずらす */
export const shiftDate = (date: string, n: number): string => {
  const [y, m, d] = date.split("-").map(Number);
  return fmtDate(addDays(new TZDate(y, m - 1, d, 12, 0, 0, 0, TZ), n));
};

/** YYYY-MM-DD を n か月ずらす（1日に丸める） */
export const shiftMonth = (date: string, n: number): string => {
  const [y, m] = date.split("-").map(Number);
  return fmtDate(addMonths(new TZDate(y, m - 1, 1, 12, 0, 0, 0, TZ), n));
};

/** その日の曜日（0=日 … 6=土） */
export const weekdayOf = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return new TZDate(y, m - 1, d, 12, 0, 0, 0, TZ).getDay();
};

export const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 営業日 + 経過分 → UTC の ISO 文字列。
 * minutes は 1440 を超えてよい（1500 = 翌日の 1:00）。
 */
export const minutesToIso = (bizDate: string, minutes: number): string => {
  const [y, m, d] = bizDate.split("-").map(Number);
  const base = new TZDate(y, m - 1, d, 0, 0, 0, 0, TZ);
  return new Date(base.getTime() + minutes * 60_000).toISOString();
};

/** UTC の ISO 文字列 → その営業日の経過分（24時を超えるぶんは 1440 超で返る） */
export const isoToMinutes = (bizDate: string, iso: string): number => {
  const [y, m, d] = bizDate.split("-").map(Number);
  const base = new TZDate(y, m - 1, d, 0, 0, 0, 0, TZ);
  return Math.round((new Date(iso).getTime() - base.getTime()) / 60_000);
};

/** 1080 → "18:00" ／ 1500 → "25:00" */
export const minutesToLabel = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/** "18:00" → 1080 ／ "25:00" → 1500 */
export const labelToMinutes = (label: string): number => {
  const [h, m] = label.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** 予約の開始時刻を「その営業日の時刻」として表示する（25:00 表記になる） */
export const startLabel = (r: { biz_date: string; starts_at: string }): string =>
  minutesToLabel(isoToMinutes(r.biz_date, r.starts_at));

/** 30分刻みの時刻チップ。開店〜閉店の範囲で作る。 */
export const timeSlots = (openMin: number, closeMin: number): number[] => {
  const out: number[] = [];
  for (let m = openMin; m <= closeMin - 30; m += 30) out.push(m);
  return out;
};

/** その月のカレンダーグリッド（日曜始まり・6週ぶん） */
export const monthGrid = (ym: string): string[] => {
  const [y, m] = ym.split("-").map(Number);
  const first = new TZDate(y, m - 1, 1, 12, 0, 0, 0, TZ);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => fmtDate(addDays(start, i)));
};

export const monthRange = (ym: string): { from: string; to: string } => {
  const [y, m] = ym.split("-").map(Number);
  const d = new TZDate(y, m - 1, 1, 12, 0, 0, 0, TZ);
  return { from: fmtDate(startOfMonth(d)), to: fmtDate(endOfMonth(d)) };
};
