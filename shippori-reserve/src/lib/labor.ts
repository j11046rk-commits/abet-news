/*
 * 人時売上（売上 ÷ 全員の労働時間）の計算（店主要望 2026-10-28）。
 *
 * 労働時間は freee人事労務 の日次の勤怠から出す。
 * freee が返す「所定内」「残業」などの区分を足し合わせるのではなく、
 * 出退勤の時刻そのもの（複数回の出退勤も全部）から休憩を引いて数える。
 * 区分の足し算は「勤務時間を自動で計算しない」設定の日に0になる項目があり、
 * 実際に店に立っていた時間とずれるため。
 *
 * このファイルは値のimportを持たない（node --test で直に回せるようにするため）。
 */

type Span = { clock_in_at?: string | null; clock_out_at?: string | null };

/** freee の日次の勤怠（使う項目だけ） */
export type FreeeWorkRecord = {
  date: string;
  clock_in_at?: string | null;
  clock_out_at?: string | null;
  work_record_segments?: Span[] | null;
  break_records?: Span[] | null;
  is_absence?: boolean | null;
};

const toRange = (s: Span): [number, number] | null => {
  if (!s.clock_in_at || !s.clock_out_at) return null;
  const a = Date.parse(s.clock_in_at);
  const b = Date.parse(s.clock_out_at);
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? [a, b] : null;
};

/** その日の労働時間（分）。出勤中で退勤が無い区間は数えない */
export function workMinutesOf(rec: FreeeWorkRecord): number {
  if (rec.is_absence) return 0;
  const segs = (
    rec.work_record_segments && rec.work_record_segments.length > 0
      ? rec.work_record_segments
      : [{ clock_in_at: rec.clock_in_at, clock_out_at: rec.clock_out_at }]
  )
    .map(toRange)
    .filter((r): r is [number, number] => r != null);
  const breaks = (rec.break_records ?? []).map(toRange).filter((r): r is [number, number] => r != null);

  let ms = 0;
  for (const [a, b] of segs) {
    ms += b - a;
    // 休憩は勤務の区間と重なる部分だけ引く（区間の外の休憩で引きすぎない）
    for (const [c, d] of breaks) ms -= Math.max(0, Math.min(b, d) - Math.max(a, c));
  }
  return Math.max(0, Math.round(ms / 60000));
}

/** 従業員ごとの日次の勤怠を、日付ごとの合計にまとめる */
export function sumByDate(
  perEmployee: FreeeWorkRecord[][],
  from: string,
  to: string,
): Map<string, { workMin: number; headcount: number }> {
  const out = new Map<string, { workMin: number; headcount: number }>();
  for (const records of perEmployee) {
    // 同じ日が2回来ても（月をまたぐサマリの重なり）1回だけ数える
    const seen = new Set<string>();
    for (const r of records) {
      if (r.date < from || r.date > to || seen.has(r.date)) continue;
      seen.add(r.date);
      const min = workMinutesOf(r);
      if (min <= 0) continue;
      const cur = out.get(r.date) ?? { workMin: 0, headcount: 0 };
      out.set(r.date, { workMin: cur.workMin + min, headcount: cur.headcount + 1 });
    }
  }
  return out;
}

/** 人時売上（円/時）。売上か労働時間が無ければ null */
export const perLaborHour = (yen: number | null, workMin: number | null | undefined): number | null =>
  yen != null && workMin != null && workMin > 0 ? Math.round(yen / (workMin / 60)) : null;

/** 「12.5h」の形 */
export const fmtHours = (workMin: number): string => `${Math.round((workMin / 60) * 10) / 10}h`;
