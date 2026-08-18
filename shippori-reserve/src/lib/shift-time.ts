/*
 * シフトの時間の読み方を1か所にまとめる。
 *
 * 3つの状態がある。取り違えると出勤時間が変わってしまうので、
 * 判定はここにだけ置き、画面では必ずこの関数を通す。
 *
 *   ① その人が時間の概念を持たない（店長・オーナー）        → null
 *   ② その日は本人の基本のとおり                            → 行の start_min が null
 *   ③ その日だけ違う                                        → 行に時刻が入っている
 *
 * さらに終わりの時刻には「LAST」がある。金土は25:00・それ以外は0:00 だが、
 * これは営業時間そのものなので、時刻を焼き付けずに null で持ち、
 * 表示するときにその日の閉店時刻を当てる。25:00 と書き込んでしまうと、
 * 営業時間を変えた日にシフトだけ古い時刻で残る。
 *
 * このファイルは値のimportを持たない（node --test で直に回せるようにするため）。
 */

/** 人ごとの基本。start が null ＝ 時間を持たない人 */
export type ShiftDefault = {
  default_start_min: number | null;
  default_end_min: number | null;
};

/** 日ごとの記録。start が null ＝ 基本のとおり */
export type ShiftRow = {
  start_min: number | null;
  end_min: number | null;
};

/** 解決した時間。end が null ＝ LAST（その日の閉店まで） */
export type ShiftTime = { start: number; end: number | null };

/**
 * その日その人の時間を決める。時間を持たない人は null。
 */
export function resolveShiftTime(
  row: ShiftRow | null | undefined,
  def: ShiftDefault | null | undefined,
): ShiftTime | null {
  if (row && row.start_min != null) return { start: row.start_min, end: row.end_min };
  if (!def || def.default_start_min == null) return null;
  return { start: def.default_start_min, end: def.default_end_min };
}

/** 基本と同じ時間か。同じなら画面では触らせない（違う日だけ直す作りにするため） */
export function isDefaultTime(
  row: ShiftRow | null | undefined,
  def: ShiftDefault | null | undefined,
): boolean {
  if (!row || row.start_min == null) return true;
  if (!def || def.default_start_min == null) return false;
  return row.start_min === def.default_start_min && row.end_min === def.default_end_min;
}

const label = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * 「19:30〜25:00」の形にする。LAST はその日の閉店時刻を当てる。
 * closeMin が分からない日は「LAST」の字のまま出す（嘘の時刻を出さない）。
 */
export function shiftTimeLabel(t: ShiftTime | null, closeMin?: number | null): string {
  if (!t) return "";
  const end = t.end ?? closeMin ?? null;
  return `${label(t.start)}〜${end == null ? "LAST" : label(end)}`;
}

/** 短い表示（暦のチップなど）。「19:30〜」だけ */
export function shiftStartLabel(t: ShiftTime | null): string {
  return t ? `${label(t.start)}〜` : "";
}

/** その日の閉店時刻。営業日の設定があればそれ、無ければ曜日から（金土25:00・他24:00） */
export function closeMinOf(
  date: string,
  day?: { close_min?: number | null } | null,
): number {
  if (day && typeof day.close_min === "number" && day.close_min > 0) return day.close_min;
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=日 … 6=土
  return dow === 5 || dow === 6 ? 1500 : 1440;
}
