"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createSession,
  deleteSession,
  updateSession,
  type SessionInput,
} from "@/app/(app)/sessions/actions";
import { parseYen, yen } from "@/lib/money";
import { fmtDate, fmtTime } from "@/lib/time";
import type { Session } from "@/lib/types";

export default function SessionForm({
  editing,
  onDone,
  onCancel,
}: {
  editing?: Session | null;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();

  const [date, setDate] = useState(editing ? fmtDate(editing.started_at) : fmtDate(new Date()));
  const [startTime, setStartTime] = useState(editing ? fmtTime(editing.started_at) : "20:00");
  const [endTime, setEndTime] = useState(editing?.ended_at ? fmtTime(editing.ended_at) : "");
  const [rake, setRake] = useState(editing?.rake_yen ?? 0);
  const [headcount, setHeadcount] = useState(editing?.headcount ?? 4);
  const [note, setNote] = useState(editing?.note ?? "");

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const input: SessionInput = { date, startTime, endTime, rakeYen: rake, headcount, note };
    const res = editing ? await updateSession(editing.id, input) : await createSession(input);

    setBusy(false);
    if (!res.ok) return setError(res.error);

    router.refresh();
    onDone?.();
  }

  async function remove() {
    if (!editing) return;
    setBusy(true);
    const res = await deleteSession(editing.id);
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "削除できませんでした。");
    router.refresh();
    onDone?.();
  }

  return (
    <form onSubmit={submit} className="rform">
      {/* 卓が終わった直後に打ち込みたいのは金額。最初に、いちばん大きく。 */}
      <div>
        <label className="field-label" htmlFor="s-rake">
          レーキ合計
        </label>
        <input
          id="s-rake"
          className="field field-num sform__rake"
          inputMode="numeric"
          pattern="[0-9]*"
          value={rake === 0 ? "" : String(rake)}
          onChange={(e) => setRake(Math.max(0, parseYen(e.target.value)))}
          placeholder="0"
          autoComplete="off"
        />
        <p className="micro sform__preview amount">{yen(rake)}</p>
      </div>

      <div className="rform__row2">
        <div>
          <label className="field-label" htmlFor="s-date">
            開催日
          </label>
          <input
            id="s-date"
            type="date"
            className="field field-num"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="field-label" htmlFor="s-head">
            参加人数
          </label>
          <input
            id="s-head"
            type="number"
            inputMode="numeric"
            min={1}
            max={30}
            className="field field-num"
            value={headcount}
            onChange={(e) => setHeadcount(Math.max(1, Number(e.target.value) || 1))}
            required
          />
        </div>
      </div>

      <div className="rform__row2">
        <div>
          <label className="field-label" htmlFor="s-start">
            開始
          </label>
          <input
            id="s-start"
            type="time"
            step={300}
            className="field field-num"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="field-label" htmlFor="s-end">
            終了（任意）
          </label>
          <input
            id="s-end"
            type="time"
            step={300}
            className="field field-num"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="field-label" htmlFor="s-note">
          メモ（任意）
        </label>
        <textarea
          id="s-note"
          className="field"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {error ? <p className="err">{error}</p> : null}

      <p className="micro">保存すると台帳にレーキの収入行が自動で起票されます。</p>

      <div className="rform__actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "記録中" : editing ? "更新する" : "記録する"}
        </button>
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            やめる
          </button>
        ) : null}
        {editing ? (
          <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
            削除
          </button>
        ) : null}
      </div>
    </form>
  );
}
