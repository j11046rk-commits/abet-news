import { yen } from "@/lib/money";
import { pairTables, rakeStartedOn } from "@/lib/tables";
import { addDaysJst, fmt, fmtDate, fmtTime, jstHourToIso } from "@/lib/time";
import { purposeMeta, type Reservation, type Session } from "@/lib/types";

/** 今週の予約と卓を曜日ごとの横並びで。ダッシュボードの最後の段。 */
export default function WeekStrip({
  weekStart,
  reservations,
  sessions,
  names,
}: {
  weekStart: string;
  reservations: Reservation[];
  /** 実際に立った卓。予約が無い夜もここに出る。 */
  sessions: Session[];
  names: Record<string, string>;
}) {
  const today = fmtDate(new Date());
  const days = Array.from({ length: 7 }, (_, i) =>
    fmtDate(addDaysJst(new Date(`${weekStart}T00:00:00+09:00`), i)),
  );

  // 予約と卓が重なっていれば同じ夜のこと。予約の側に寄せて、卓は単独のときだけ出す。
  const { byReservation, loose } = pairTables(reservations, sessions);
  const poker = purposeMeta("poker");

  return (
    <div className="wstrip">
      {days.map((d) => {
        const dayStart = new Date(jstHourToIso(d, 0)).getTime();
        const dayEnd = new Date(jstHourToIso(d, 24)).getTime();
        const startedToday = (iso: string) => {
          const t = new Date(iso).getTime();
          return t >= dayStart && t < dayEnd;
        };

        // 1回の開催は1つだけ出す。深夜2時までの卓を翌日にも出すと、2回あったように見える。
        const items = reservations.filter((r) => startedToday(r.starts_at));
        const tables = loose.filter((s) => startedToday(s.started_at));
        const rake =
          rakeStartedOn(sessions, dayStart, dayEnd);

        return (
          <div key={d} className={`wstrip__day${d === today ? " is-today" : ""}`}>
            <span className="micro wstrip__dow">{fmt(new Date(`${d}T00:00:00+09:00`), "E")}</span>
            <span className="wstrip__num num">{Number(d.slice(8))}</span>

            <div className="wstrip__items">
              {items.length === 0 && tables.length === 0 ? (
                <span className="wstrip__none" aria-hidden />
              ) : (
                <>
                  {items.map((r) => {
                    const m = purposeMeta(r.purposes[0]);
                    const rk = rakeStartedOn(byReservation.get(r.id), dayStart, dayEnd);
                    // 数字だけだと人数にも件数にも見えるので、時刻として読める形で出す
                    return (
                      <span
                        key={r.id}
                        className={`wstrip__item${r.is_exclusive ? " is-exclusive" : ""}`}
                        style={{
                          borderColor: m.color,
                          background: r.is_exclusive ? m.color : "transparent",
                          color: r.is_exclusive ? m.onFill : "var(--smoke)",
                        }}
                        title={`${names[r.created_by] ?? "メンバー"} ${fmtTime(r.starts_at)}–${fmtTime(r.ends_at)}${rk ? ` · レーキ ${yen(rk)}` : ""}`}
                      >
                        {fmtTime(r.starts_at)}
                      </span>
                    );
                  })}

                  {/* 予約せずに立った卓。予約と同じ形で、始まった時刻を出す。 */}
                  {tables.map((s) => (
                    <span
                      key={s.id}
                      className="wstrip__item"
                      style={{ borderColor: poker.color, color: "var(--smoke)" }}
                      title={`${s.created_by ? (names[s.created_by] ?? "メンバー") : "メンバー"} ${fmtTime(s.started_at)}〜 · レーキ ${yen(s.rake_yen)}`}
                    >
                      {fmtTime(s.started_at)}
                    </span>
                  ))}
                </>
              )}

              {/* その夜のレーキ。TOP で今週を見る理由は、たいていこの数字。 */}
              {rake > 0 ? <span className="wstrip__rake amount">{yen(rake)}</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
