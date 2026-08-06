"use client";

import { useState } from "react";
import SessionForm from "@/components/SessionForm";
import { yen } from "@/lib/money";
import { fmtDateJa, fmtTime } from "@/lib/time";
import { gameTypeJa, type Player, type Session } from "@/lib/types";

export default function SessionsClient({
  meId,
  isOwner,
  sessions,
  players,
  playerNames,
  playerIds,
  openForm,
}: {
  meId: string;
  isOwner: boolean;
  sessions: Session[];
  players: Player[];
  playerNames: Record<string, string[]>;
  playerIds: Record<string, string[]>;
  openForm?: boolean;
}) {
  const [creating, setCreating] = useState(Boolean(openForm));
  const [editing, setEditing] = useState<Session | null>(null);

  const canEdit = (s: Session) => isOwner || s.created_by === meId;

  return (
    <>
      <header className="page">
        <h1 className="display">セッション</h1>
        <p className="dim page__lead">卓が終わったら、その場で。金額から入れられます。</p>
      </header>

      <div className="rule">
        <span className="label">New record</span>
      </div>

      {creating ? (
        <div className="surface">
          <SessionForm
            players={players}
            onDone={() => setCreating(false)}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : (
        <button className="btn btn-primary block" onClick={() => setCreating(true)}>
          記録する
        </button>
      )}

      <div className="rule">
        <span className="label">Records — {sessions.length}</span>
      </div>

      {sessions.length === 0 ? (
        <p className="empty">まだ記録がありません。今夜の卓から始めましょう。</p>
      ) : (
        <ul className="slist">
          {sessions.map((s) =>
            editing?.id === s.id ? (
              <li key={s.id} className="surface">
                <SessionForm
                  players={players}
                  editing={s}
                  editingPlayerIds={playerIds[s.id] ?? []}
                  onDone={() => setEditing(null)}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={s.id} className="scard">
                <div className="scard__head">
                  <span className="scard__date mincho">{fmtDateJa(s.started_at)}</span>
                  <span className="scard__rake amount">{yen(s.rake_yen)}</span>
                </div>
                <div className="scard__meta">
                  <span className="micro">{gameTypeJa(s.game_type)}</span>
                  <span className="micro">
                    {fmtTime(s.started_at)}
                    {s.ended_at ? `–${fmtTime(s.ended_at)}` : ""}
                  </span>
                  <span className="micro">{playerNames[s.id]?.length ?? 0}名</span>
                  {canEdit(s) ? (
                    <button className="btn btn-sm scard__edit" onClick={() => setEditing(s)}>
                      編集
                    </button>
                  ) : null}
                </div>
                {playerNames[s.id]?.length ? (
                  <p className="micro scard__players">{playerNames[s.id].join(" · ")}</p>
                ) : null}
                {s.note ? <p className="dim scard__note">{s.note}</p> : null}
              </li>
            ),
          )}
        </ul>
      )}
    </>
  );
}
