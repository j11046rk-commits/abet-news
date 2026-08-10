import Link from "next/link";
import { SourceBadge } from "@/components/Badges";
import { startLabel } from "@/lib/time";
import { seatKind } from "@/lib/seats";
import type { Reservation } from "@/lib/types";

export default function ReservationCard({
  reservation: r,
  attention,
  registrar,
  note,
}: {
  reservation: Reservation;
  /** 要対応（電話番号なし）なら左に朱の線が入る */
  attention?: string | null;
  /** 受付した人の表示名。「誰が受けた予約か」を一目にするため常に出す */
  registrar?: string | null;
  /** コース・メモ。タップしなくても読めるよう全文をそのまま出す */
  note?: string | null;
}) {
  const cancelled = r.status === "cancelled" || r.status === "no_show";

  const kind = seatKind(r.seat_note);

  return (
    <article className={`card ${attention ? "card--flag" : ""} ${kind ? `card--seat-${kind}` : ""}`}>
      <Link href={`/reservations/${r.id}`} className="resv" style={{ color: "inherit" }}>
        <div className="resv__time">{startLabel(r)}</div>
        <div>
          <div
            className="resv__name"
            style={cancelled ? { textDecoration: "line-through", opacity: 0.6 } : undefined}
          >
            {r.customer_name} <span className="muted">様</span>
            <span className="muted" style={{ fontWeight: 400 }}>
              {" "}
              {r.party_size}名
            </span>
          </div>
          <div className="resv__meta">
            <SourceBadge source={r.source} />
            {cancelled ? <span className="badge badge--cancelled">キャンセル</span> : null}
            {r.seat_note ? <span>{r.seat_note}</span> : null}
            {r.phone ? <span>{r.phone}</span> : null}
            {registrar ? <span>受付 {registrar}</span> : null}
          </div>
          {note && !cancelled ? (
            <p className="micro" style={{ marginTop: "0.25rem", whiteSpace: "pre-wrap" }}>
              {note}
            </p>
          ) : null}
          {attention ? <p className="micro" style={{ color: "var(--seal)" }}>{attention}</p> : null}
        </div>
      </Link>
    </article>
  );
}
