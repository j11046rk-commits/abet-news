/**
 * 日本の祝日。外部サービスに頼らず、法則から計算する（2000〜2099年で有効）。
 * 固定日＋ハッピーマンデー＋春分・秋分（天文近似式）＋振替休日＋国民の休日。
 */

const FIXED: ReadonlyArray<readonly [number, number, string]> = [
  [1, 1, "元日"],
  [2, 11, "建国記念の日"],
  [2, 23, "天皇誕生日"],
  [4, 29, "昭和の日"],
  [5, 3, "憲法記念日"],
  [5, 4, "みどりの日"],
  [5, 5, "こどもの日"],
  [8, 11, "山の日"],
  [11, 3, "文化の日"],
  [11, 23, "勤労感謝の日"],
];

/** [月, 第n月曜, 名前] */
const HAPPY_MONDAY: ReadonlyArray<readonly [number, number, string]> = [
  [1, 2, "成人の日"],
  [7, 3, "海の日"],
  [9, 3, "敬老の日"],
  [10, 2, "スポーツの日"],
];

const pad2 = (n: number) => String(n).padStart(2, "0");
const key = (m: number, d: number) => `${pad2(m)}-${pad2(d)}`;
const dowOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** 第n週の指定曜日が何日か（月曜=1） */
function nthMonday(y: number, m: number, nth: number): number {
  const first = dowOf(y, m, 1);
  const offset = (8 - first) % 7; // 最初の月曜まで
  return 1 + offset + (nth - 1) * 7;
}

/** 春分・秋分の日（2000〜2099年の近似式。国立天文台の官報告示と一致する） */
const shunbun = (y: number) => Math.floor(20.69115 + 0.242194 * (y - 2000)) - Math.floor((y - 2000) / 4);
const shuubun = (y: number) => Math.floor(23.09 + 0.242194 * (y - 2000)) - Math.floor((y - 2000) / 4);

const cache = new Map<number, Map<string, string>>();

function yearHolidays(y: number): Map<string, string> {
  const hit = cache.get(y);
  if (hit) return hit;

  const map = new Map<string, string>();
  for (const [m, d, name] of FIXED) map.set(key(m, d), name);
  for (const [m, nth, name] of HAPPY_MONDAY) map.set(key(m, nthMonday(y, m, nth)), name);
  map.set(key(3, shunbun(y)), "春分の日");
  map.set(key(9, shuubun(y)), "秋分の日");

  // 振替休日：日曜の祝日は、次の「祝日でない日」が休みになる
  for (const [k] of [...map]) {
    const [m, d] = k.split("-").map(Number);
    if (dowOf(y, m, d) !== 0) continue;
    let nm = m;
    let nd = d + 1;
    while (map.has(key(nm, nd))) nd += 1;
    if (nd > daysInMonth(y, nm)) {
      nd -= daysInMonth(y, nm);
      nm += 1;
    }
    if (nm <= 12) map.set(key(nm, nd), "振替休日");
  }

  // 国民の休日：祝日と祝日に挟まれた平日は休みになる（9月の連休など）
  for (let m = 1; m <= 12; m++) {
    for (let d = 2; d < daysInMonth(y, m); d++) {
      if (map.has(key(m, d))) continue;
      if (dowOf(y, m, d) === 0) continue;
      if (map.has(key(m, d - 1)) && map.has(key(m, d + 1))) map.set(key(m, d), "国民の休日");
    }
  }

  cache.set(y, map);
  return map;
}

/** 祝日名（YYYY-MM-DD → 名前。祝日でなければ null） */
export function holidayName(date: string): string | null {
  const y = Number(date.slice(0, 4));
  if (!Number.isFinite(y) || y < 2000 || y > 2099) return null;
  return yearHolidays(y).get(date.slice(5)) ?? null;
}

export const isHoliday = (date: string): boolean => holidayName(date) !== null;
