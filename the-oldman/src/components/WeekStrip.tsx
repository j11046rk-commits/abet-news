import { addDaysJst, fmt, fmtDate, fmtTime, jstHourToIso } from "@/lib/time";
import { purposeMeta, type Reservation } from "@/lib/types";

/** 今週の予約を曜日ごとの横並びで。ダッシュボードの最後の段。 */
export default function WeekStrip({
  weekStart,
  reservations,
  names,
}: {
  weekStart: string;
  reservations: Reservation[];
  names: Record<string, string>;
}) {
  const today = fmtDate(new Date());
  const days = Array.from({ length: 7 }, (_, i) =>
    fmtDate(addDaysJst(new Date(`${weekStart}T00:00:00+09:00`), i)),
  );

  return (
    <div className="wstrip">
      {days.map((d) => {
        const dayStart = new Date(jstHourToIso(d, 0)).getTime();
        const dayEnd = new Date(jstHourToIso(d, 24)).getTime();
        // 1回の開催は1つだけ出す。深夜2時までの卓を翌日にも出すと、2回あったように見える。
        const items = reservations.filter((r) => {
          const s = new Date(r.starts_at).getTime();
          return s >= dayStart && s < dayEnd;
        });

        return (
          <div key={d} className={`wstrip__day${d === today ? " is-today" : ""}`}>
            <span className="micro wstrip__dow">{fmt(new Date(`${d}T00:00:00+09:00`), "E")}</span>
            <span className="wstrip__num num">{Number(d.slice(8))}</span>

            <div className="wstrip__items">
              {items.length === 0 ? (
                <span className="wstrip__none" aria-hidden />
              ) : (
                items.map((r) => {
                  const m = purposeMeta(r.purposes[0]);
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
                      title={`${names[r.created_by] ?? "メンバー"} ${fmtTime(r.starts_at)}–${fmtTime(r.ends_at)}`}
                    >
                      {fmtTime(r.starts_at)}
                    </span>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
