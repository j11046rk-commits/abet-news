import { SOURCE_SHORT, STATUS_LABEL } from "@/lib/constants";
import type { BusinessMode, ReservationSource, ReservationStatus } from "@/lib/types";

export function SourceBadge({ source }: { source: ReservationSource }) {
  return <span className="badge badge--source">{SOURCE_SHORT[source]}</span>;
}

export function StatusBadge({ status }: { status: ReservationStatus }) {
  // 「確定」は一番多い状態なので、あえてバッジを出さず画面を静かにしておく
  if (status === "confirmed") return null;
  return <span className={`badge badge--${status}`}>{STATUS_LABEL[status]}</span>;
}

export function ModeBadge({
  mode,
  isBusy,
  isClosed,
  eventName,
}: {
  mode: BusinessMode;
  isBusy: boolean;
  isClosed: boolean;
  eventName?: string | null;
}) {
  return (
    <>
      {isClosed ? <span className="badge badge--closed">休業</span> : null}
      {mode === "event" ? (
        <span className="badge badge--event">{eventName || "イベント営業"}</span>
      ) : null}
      {isBusy ? <span className="badge badge--busy">繁忙日</span> : null}
    </>
  );
}
