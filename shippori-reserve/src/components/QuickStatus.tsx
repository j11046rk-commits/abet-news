"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setReservationStatus } from "@/app/(app)/reservations/actions";
import type { ReservationStatus } from "@/lib/types";

/**
 * 「来店」「会計済」を1タップで。当日いちばん多い操作なので、詳細を開かせない。
 */
export default function QuickStatus({
  id,
  status,
}: {
  id: string;
  status: ReservationStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const go = (next: ReservationStatus) =>
    startTransition(async () => {
      await setReservationStatus(id, next);
      router.refresh();
    });

  if (status === "cancelled" || status === "no_show" || status === "completed") return null;

  return (
    <div className="resv__actions">
      {status === "tentative" ? (
        <button className="btn btn-sm" disabled={pending} onClick={() => go("confirmed")}>
          確定にする
        </button>
      ) : null}
      {status === "confirmed" || status === "tentative" ? (
        <button className="btn btn-sm btn-ghost" disabled={pending} onClick={() => go("seated")}>
          来店
        </button>
      ) : null}
      {status === "seated" ? (
        <button className="btn btn-sm btn-ghost" disabled={pending} onClick={() => go("completed")}>
          会計済
        </button>
      ) : null}
    </div>
  );
}
