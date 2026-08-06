"use client";

import { useState } from "react";
import ReservationCard from "@/components/ReservationCard";
import ReservationForm from "@/components/ReservationForm";
import type { Reservation } from "@/lib/types";

export default function ReservationsClient({
  meId,
  isOwner,
  names,
  upcoming,
  past,
  presetDate,
  presetStart,
  presetEnd,
  openForm,
}: {
  meId: string;
  isOwner: boolean;
  names: Record<string, string>;
  upcoming: Reservation[];
  past: Reservation[];
  presetDate?: string;
  presetStart?: number;
  presetEnd?: number;
  openForm?: boolean;
}) {
  const [creating, setCreating] = useState(Boolean(openForm));
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [showPast, setShowPast] = useState(false);

  const canEdit = (r: Reservation) => isOwner || r.created_by === meId;

  return (
    <>
      <div className="rule">
        <span className="label">New booking</span>
      </div>

      {creating ? (
        <div className="surface">
          <ReservationForm
            names={names}
            presetDate={presetDate}
            presetStart={presetStart}
            presetEnd={presetEnd}
            onDone={() => setCreating(false)}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : (
        <button className="btn btn-primary block" onClick={() => setCreating(true)}>
          予約する
        </button>
      )}

      <div className="rule">
        <span className="label">Upcoming</span>
      </div>

      {upcoming.length === 0 ? (
        <p className="empty">これからの予約はありません。</p>
      ) : (
        <ul className="rlist">
          {upcoming.map((r) =>
            editing?.id === r.id ? (
              <li key={r.id} className="surface">
                <ReservationForm
                  names={names}
                  editing={r}
                  onDone={() => setEditing(null)}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={r.id}>
                <ReservationCard
                  reservation={r}
                  ownerName={names[r.created_by] ?? "メンバー"}
                  editable={canEdit(r)}
                  onEdit={() => setEditing(r)}
                />
              </li>
            ),
          )}
        </ul>
      )}

      <div className="rule">
        <button className="label rlist__toggle" onClick={() => setShowPast((v) => !v)}>
          Past — {past.length}件 {showPast ? "閉じる" : "開く"}
        </button>
      </div>

      {showPast ? (
        past.length === 0 ? (
          <p className="empty">過去の予約はまだありません。</p>
        ) : (
          <ul className="rlist rlist--past">
            {past.map((r) => (
              <li key={r.id}>
                <ReservationCard
                  reservation={r}
                  ownerName={names[r.created_by] ?? "メンバー"}
                  editable={false}
                  past
                />
              </li>
            ))}
          </ul>
        )
      ) : null}
    </>
  );
}
