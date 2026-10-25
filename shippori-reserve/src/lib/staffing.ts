/*
 * シフトの「この日は何人で回せるか」の目安（店主要望 2026-10-25：人件費を削りたい）。
 *
 * 考え方は3段。どれも店の過去の実績から出し、勘の数字を焼き付けない。
 *
 *   ① 予想客数 … 同じ曜日の過去の客数（中央値）と、
 *                 「入っている予約＋同じ曜日の予約なしの来店（中央値）」の大きいほう。
 *                 シフトを組む時点（前月）では予約がほぼ無いので、①の前半が効く。
 *                 予約が積み上がると後半が上回り、目安も上がる
 *   ② 1人で回せる客数 … 過去の日の「客数÷出勤人数」の上位25%点（75パーセンタイル）。
 *                 「忙しい日でもこの人数で回せていた」水準。中央値にすると
 *                 人を多めに入れていた過去をそのままなぞるだけになる
 *   ③ 目安人数 … ①÷② の切り上げ。最低人数を下回らない
 *
 * 祝日の前日は土曜と同じに扱う（静かな日のクーポンの判定と同じ考え方）。
 *
 * このファイルは値のimportを持たない（node --test で直に回せるようにするため）。
 */

/** 過去の1日ぶん。営業していて客数が取れている日だけ渡す */
export type StaffingHistoryDay = {
  /** 曜日の区分（0=日〜6=土。祝前日は6） */
  key: number;
  /** その日の客数（エアレジ） */
  guests: number;
  /** その日の予約の人数（キャンセル・無断キャンセルを除く） */
  booked: number;
  /** その日の出勤人数（確定シフト）。不明なら 0 */
  staff: number;
};

export type StaffingModel = {
  /** 曜日区分ごとの客数の中央値 */
  guestsByKey: Map<number, number>;
  /** 曜日区分ごとの予約なし来店の中央値 */
  walkInByKey: Map<number, number>;
  /** 1人で回せる客数（過去の実績から。足りなければ既定値） */
  perStaff: number;
  /** perStaff を過去の実績から出せたか（画面の注記に使う） */
  perStaffFromHistory: boolean;
};

/** 曜日区分ごとに最低これだけ日数がないと、その曜日の数字は使わない */
const MIN_SAMPLES = 3;
/** perStaff を実績から出すのに要る日数 */
const MIN_RATIO_SAMPLES = 10;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** 線形補間のパーセンタイル（p は 0〜1） */
export const percentile = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
};

/** 金土（祝前日を含む）とそれ以外の2区分。曜日ごとの日数が足りないときの受け皿 */
const groupOf = (key: number): "frisat" | "weekday" => (key === 5 || key === 6 ? "frisat" : "weekday");

export function buildStaffingModel(
  history: StaffingHistoryDay[],
  fallbackPerStaff: number,
): StaffingModel {
  const days = history.filter((d) => d.guests > 0);

  const byKey = new Map<number, StaffingHistoryDay[]>();
  const byGroup = new Map<string, StaffingHistoryDay[]>();
  for (const d of days) {
    (byKey.get(d.key) ?? byKey.set(d.key, []).get(d.key)!).push(d);
    const g = groupOf(d.key);
    (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(d);
  }

  const guestsByKey = new Map<number, number>();
  const walkInByKey = new Map<number, number>();
  for (let key = 0; key <= 6; key++) {
    // 曜日の日数が足りなければ、平日／金土のまとまりで代用する
    const pool = (byKey.get(key)?.length ?? 0) >= MIN_SAMPLES ? byKey.get(key)! : byGroup.get(groupOf(key));
    if (!pool || pool.length < MIN_SAMPLES) continue;
    guestsByKey.set(key, median(pool.map((d) => d.guests)));
    walkInByKey.set(key, median(pool.map((d) => Math.max(0, d.guests - d.booked))));
  }

  const ratios = days.filter((d) => d.staff > 0).map((d) => d.guests / d.staff);
  const fromHistory = ratios.length >= MIN_RATIO_SAMPLES;
  const perStaff = fromHistory ? Math.max(1, percentile(ratios, 0.75)) : fallbackPerStaff;

  return { guestsByKey, walkInByKey, perStaff, perStaffFromHistory: fromHistory };
}

export type StaffingForecast = {
  /** 予想客数（整数に丸めたもの） */
  expected: number;
  /** その日に入っている予約の人数 */
  booked: number;
  /** 目安の人数 */
  recommended: number;
};

/**
 * その日の予想客数と目安人数。過去の数字が無い曜日は null（嘘の目安を出さない）。
 */
export function forecastDay(
  model: StaffingModel,
  key: number,
  booked: number,
  minStaff: number,
): StaffingForecast | null {
  const base = model.guestsByKey.get(key);
  const walkIn = model.walkInByKey.get(key);
  if (base == null || walkIn == null) return null;
  const expected = Math.round(Math.max(base, booked + walkIn));
  const recommended = Math.max(minStaff, Math.ceil(expected / model.perStaff));
  return { expected, booked, recommended };
}
