import { durationHours, fmtDateJa, fmtTime } from "@/lib/time";
import { purposeMeta, type Reservation } from "@/lib/types";

/**
 * 貸切バッジは --claret の塗りだが面積は極小に保つ（DESIGN.md §9-6）。
 * 既定は「相席OK」。合流できることが伝わる表示にする。
 */
export default function ReservationCard({
  reservation: r,
  ownerName,
  editable,
  past,
  onEdit,
}: {
  reservation: Reservation;
  ownerName: string;
  editable: boolean;
  past?: boolean;
  onEdit?: () => void;
}) {
  return (
    <article className={`rcard surface${past ? " rcard--past" : ""}`}>
      <div className="rcard__head">
        <div className="rcard__when">
          <span className="rcard__date mincho">{fmtDateJa(r.starts_at)}</span>
          <span className="rcard__time amount">
            {fmtTime(r.starts_at)}–{fmtTime(r.ends_at)}
          </span>
          <span className="micro">{durationHours(r.starts_at, r.ends_at)} h</span>
        </div>
        <span className={r.is_exclusive ? "badge badge-exclusive" : "badge badge-outline"}>
          {r.is_exclusive ? "貸切" : "相席OK"}
        </span>
      </div>

      <div className="rcard__purposes">
        {r.purposes.map((p) => {
          const m = purposeMeta(p);
          return (
            <span key={p} className="rcard__purpose" style={{ color: m.text }}>
              {m.en}
            </span>
          );
        })}
      </div>

      {r.title ? <p className="rcard__title">{r.title}</p> : null}

      <div className="rcard__foot">
        <span className="micro">
          {ownerName} · {r.headcount}名
        </span>
        {editable && onEdit ? (
          <button className="btn btn-sm" onClick={onEdit}>
            編集
          </button>
        ) : null}
      </div>

      {r.memo ? <p className="rcard__memo dim">{r.memo}</p> : null}
    </article>
  );
}
