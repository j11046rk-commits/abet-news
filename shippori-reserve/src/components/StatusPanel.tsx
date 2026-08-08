"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setReservationStatus } from "@/app/(app)/reservations/actions";
import type { ReservationStatus } from "@/lib/types";

/**
 * 状態遷移。削除は無い。キャンセルは理由を書いて記録として残す。
 * 「言った・言わない」を後から辿れることのほうが、行を消せることより大事。
 */
export default function StatusPanel({
  id,
  status,
}: {
  id: string;
  status: ReservationStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  const go = (next: ReservationStatus, cancelReason?: string) =>
    startTransition(async () => {
      const res = await setReservationStatus(id, next, cancelReason);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setCancelling(false);
      setReason("");
      router.refresh();
    });

  return (
    <section className="card stack">
      <p className="micro" style={{ letterSpacing: "0.12em" }}>
        状態を変える
      </p>

      <div className="chips">
        {status !== "confirmed" && status !== "completed" ? (
          <button className="btn btn-sm" disabled={pending} onClick={() => go("confirmed")}>
            確定
          </button>
        ) : null}
        {status !== "seated" ? (
          <button className="btn btn-sm" disabled={pending} onClick={() => go("seated")}>
            来店
          </button>
        ) : null}
        {status !== "completed" ? (
          <button className="btn btn-sm" disabled={pending} onClick={() => go("completed")}>
            会計済
          </button>
        ) : null}
        {status !== "no_show" ? (
          <button
            className="btn btn-sm btn-danger"
            disabled={pending}
            onClick={() => go("no_show")}
          >
            無断キャンセル
          </button>
        ) : null}
        {status !== "cancelled" ? (
          <button
            className="btn btn-sm btn-danger"
            disabled={pending}
            onClick={() => setCancelling((v) => !v)}
          >
            キャンセル
          </button>
        ) : null}
      </div>

      {cancelling ? (
        <div className="stack">
          <label className="field-label" htmlFor="cancel_reason">
            キャンセルの理由<span className="req">必須</span>
          </label>
          <input
            id="cancel_reason"
            className="field"
            placeholder="例：お客様都合・体調不良のため"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            className="btn btn-danger btn-block"
            disabled={pending || !reason.trim()}
            onClick={() => go("cancelled", reason)}
          >
            キャンセルとして記録する
          </button>
        </div>
      ) : null}

      {error ? <p className="err">{error}</p> : null}
    </section>
  );
}
