import Link from "next/link";
import { SourceBadge, StatusBadge } from "@/components/Badges";
import QuickStatus from "@/components/QuickStatus";
import { startLabel } from "@/lib/time";
import type { Reservation } from "@/lib/types";

export default function ReservationCard({
  reservation: r,
  attention,
  showActions = true,
  registrar,
}: {
  reservation: Reservation;
  /** 要対応（席未割当・当日なのに仮予約・電話番号なし）なら左に朱の線が入る */
  attention?: string | null;
  showActions?: boolean;
  /** 受付した人の表示名。「誰が受けた予約か」を一目にするため常に出す */
  registrar?: string | null;
}) {
  return (
    <article id={`r-${r.id}`} className={`card ${attention ? "card--flag" : ""}`}>
      <Link href={`/reservations/${r.id}`} className="resv" style={{ color: "inherit" }}>
        <div className="resv__time">{startLabel(r)}</div>
        <div>
          <div className="resv__name">
            {r.customer_name} <span className="muted">様</span>
            <span className="muted" style={{ fontWeight: 400 }}>
              {" "}
              {r.party_size}名
            </span>
          </div>
          <div className="resv__meta">
            <SourceBadge source={r.source} />
            <StatusBadge status={r.status} />
            {r.seat_note ? <span>{r.seat_note}</span> : null}
            {r.drink_plan ? <span>飲み放題</span> : null}
            {r.phone ? <span>{r.phone}</span> : null}
            {registrar ? <span>受付 {registrar}</span> : null}
          </div>
          {attention ? <p className="micro" style={{ color: "var(--seal)" }}>{attention}</p> : null}
        </div>
      </Link>

      {showActions ? <QuickStatus id={r.id} status={r.status} /> : null}
    </article>
  );
}
