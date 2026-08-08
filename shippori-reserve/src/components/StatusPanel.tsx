"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setReservationStatus } from "@/app/(app)/reservations/actions";

/**
 * キャンセルだけを扱う。
 * 「状態（来店中・会計済など）」の概念は店主判断で廃止した（2026-08-08）。
 * 予約は「ある」か「キャンセルされた」かの2つだけ。行は消さず、理由と一緒に残す。
 */
export default function StatusPanel({
  id,
  cancelled,
  cancelReason,
}: {
  id: string;
  cancelled: boolean;
  cancelReason: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "変更できませんでした。");
        return;
      }
      setError(null);
      setOpen(false);
      setReason("");
      router.refresh();
    });

  if (cancelled) {
    return (
      <section className="card stack">
        <p className="notice notice-strong" style={{ margin: 0 }}>
          この予約はキャンセルされています。
          {cancelReason ? `（理由：${cancelReason}）` : ""}
        </p>
        <button
          className="btn btn-block"
          disabled={pending}
          onClick={() => run(() => setReservationStatus(id, "confirmed"))}
        >
          キャンセルを取り消す（予約を復活させる）
        </button>
        {error ? <p className="err">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="card stack">
      {!open ? (
        <button className="btn btn-danger btn-block" onClick={() => setOpen(true)}>
          この予約をキャンセルする
        </button>
      ) : (
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
          <div className="row">
            <button
              className="btn btn-danger"
              style={{ flex: 1 }}
              disabled={pending || !reason.trim()}
              onClick={() => run(() => setReservationStatus(id, "cancelled", reason))}
            >
              キャンセルとして記録する
            </button>
            <button className="btn" disabled={pending} onClick={() => setOpen(false)}>
              やめる
            </button>
          </div>
        </div>
      )}
      {error ? <p className="err">{error}</p> : null}
    </section>
  );
}
