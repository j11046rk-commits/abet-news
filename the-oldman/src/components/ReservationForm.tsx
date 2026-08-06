"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  createReservation,
  deleteReservation,
  updateReservation,
  type ReservationInput,
} from "@/app/(app)/reservations/actions";
import { createClient } from "@/lib/supabase/client";
import { fmtDate, fmtDateJa, jstEndHourOnStartDate, jstHour, jstHourToIso } from "@/lib/time";
import { PURPOSES, type Reservation, type ReservationPurpose } from "@/lib/types";

type Conflict = {
  id: string;
  created_by: string;
  is_exclusive: boolean;
  starts_at: string;
  ends_at: string;
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const END_HOURS = Array.from({ length: 24 }, (_, i) => i + 1);
const hhmm = (h: number) => `${String(h).padStart(2, "0")}:00`;

export default function ReservationForm({
  names,
  editing,
  presetDate,
  presetStart,
  presetEnd,
  onDone,
  onCancel,
}: {
  /** profile_id → 表示名 */
  names: Record<string, string>;
  editing?: Reservation | null;
  presetDate?: string;
  presetStart?: number;
  presetEnd?: number;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();

  const initial = useMemo(() => {
    if (editing) {
      return {
        date: fmtDate(editing.starts_at),
        start: jstHour(editing.starts_at),
        end: jstEndHourOnStartDate(editing.starts_at, editing.ends_at),
        purposes: editing.purposes,
        exclusive: editing.is_exclusive,
        headcount: editing.headcount,
        memo: editing.memo ?? "",
        title: editing.title ?? "",
      };
    }
    return {
      date: presetDate ?? fmtDate(new Date()),
      start: presetStart ?? 20,
      end: presetEnd ?? 24,
      purposes: ["poker"] as ReservationPurpose[],
      exclusive: false,
      headcount: 4,
      memo: "",
      title: "",
    };
  }, [editing, presetDate, presetStart, presetEnd]);

  const [date, setDate] = useState(initial.date);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [purposes, setPurposes] = useState<ReservationPurpose[]>(initial.purposes);
  const [exclusive, setExclusive] = useState(initial.exclusive);
  const [headcount, setHeadcount] = useState(initial.headcount);
  const [memo, setMemo] = useState(initial.memo);
  const [title, setTitle] = useState(initial.title);

  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [busy, setBusy] = useState(false);

  const needsMemo = purposes.includes("other");

  function togglePurpose(p: ReservationPurpose) {
    setConflicts(null);
    setPurposes((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  /** 重複はブロックしない。警告して、押し直しで通す（SPEC §3-3）。 */
  async function findConflicts(): Promise<Conflict[]> {
    const supabase = createClient();
    let q = supabase
      .from("reservations")
      .select("id, created_by, is_exclusive, starts_at, ends_at")
      .lt("starts_at", jstHourToIso(date, end))
      .gt("ends_at", jstHourToIso(date, start));
    if (editing) q = q.neq("id", editing.id);
    const { data } = await q;
    return (data ?? []) as Conflict[];
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (end <= start) return setError("終了時刻は開始時刻より後にしてください。");
    if (purposes.length === 0) return setError("用途を1つ以上選んでください。");
    if (needsMemo && memo.trim() === "")
      return setError("用途に「その他」を含む場合はメモを入力してください。");

    setBusy(true);

    // 初回の送信では重複を検知して止める。2回目はそのまま通す。
    if (conflicts === null) {
      const found = await findConflicts();
      if (found.length > 0) {
        setConflicts(found);
        setBusy(false);
        return;
      }
      setConflicts([]);
    }

    const input: ReservationInput = {
      date,
      startHour: start,
      endHour: end,
      purposes,
      isExclusive: exclusive,
      headcount,
      memo,
      title,
    };

    const res = editing
      ? await updateReservation(editing.id, input)
      : await createReservation(input);

    setBusy(false);
    if (!res.ok) return setError(res.error);

    router.refresh();
    onDone?.();
  }

  async function remove() {
    if (!editing) return;
    setBusy(true);
    const res = await deleteReservation(editing.id);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
    onDone?.();
  }

  const exclusiveConflicts = (conflicts ?? []).filter((c) => c.is_exclusive);
  const hasConflicts = (conflicts?.length ?? 0) > 0;

  return (
    <form onSubmit={submit} className="rform">
      <div className="rform__row2">
        <div>
          <label className="field-label" htmlFor="r-date">
            日付
          </label>
          <input
            id="r-date"
            type="date"
            className="field field-num"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setConflicts(null);
            }}
            required
          />
        </div>
        <div>
          <label className="field-label" htmlFor="r-head">
            想定人数
          </label>
          <input
            id="r-head"
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
          <label className="field-label" htmlFor="r-start">
            開始
          </label>
          <select
            id="r-start"
            className="field field-num"
            value={start}
            onChange={(e) => {
              const v = Number(e.target.value);
              setStart(v);
              if (end <= v) setEnd(Math.min(24, v + 1));
              setConflicts(null);
            }}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hhmm(h)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="r-end">
            終了
          </label>
          <select
            id="r-end"
            className="field field-num"
            value={end}
            onChange={(e) => {
              setEnd(Number(e.target.value));
              setConflicts(null);
            }}
          >
            {END_HOURS.filter((h) => h > start).map((h) => (
              <option key={h} value={h}>
                {hhmm(h === 24 ? 24 : h)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="rform__set">
        <legend className="field-label">用途（複数選べます）</legend>
        <div className="rform__purposes">
          {PURPOSES.map((p) => (
            <label key={p.value} className="check">
              <input
                type="checkbox"
                checked={purposes.includes(p.value)}
                onChange={() => togglePurpose(p.value)}
              />
              <span>{p.ja}</span>
              <span className="rform__code" style={{ color: p.text }} aria-hidden>
                {p.en}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* 用途の「プライベート」と貸切希望は別物。ラベルで明確に区別する（SPEC §3-3）*/}
      <div className="rform__exclusive">
        <span className="label rform__exclusive-head">貸切希望</span>
        <label className="check">
          <input
            type="checkbox"
            checked={exclusive}
            onChange={(e) => setExclusive(e.target.checked)}
          />
          <span className="rform__exclusive-label">貸切にする</span>
        </label>
        <p className="micro rform__exclusive-note">
          この時間は他のメンバーの来訪をご遠慮いただきます。
          <br />
          チェックしない場合は「相席OK」として表示され、他のメンバーが合流できます。
        </p>
      </div>

      <div>
        <label className="field-label" htmlFor="r-title">
          件名（任意）
        </label>
        <input
          id="r-title"
          className="field"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="定例卓 / 来客 など"
          maxLength={40}
        />
      </div>

      <div>
        <label className="field-label" htmlFor="r-memo">
          メモ{needsMemo ? "（必須）" : "（任意）"}
        </label>
        <textarea
          id="r-memo"
          className="field"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          required={needsMemo}
        />
      </div>

      {error ? <p className="err">{error}</p> : null}

      {hasConflicts ? (
        <div className={`notice${exclusiveConflicts.length > 0 ? " notice-strong" : ""}`}>
          {exclusiveConflicts.length > 0 ? (
            <p>
              この時間は
              {exclusiveConflicts.map((c) => names[c.created_by] ?? "メンバー").join("・")}
              さんが貸切にしています。それでも予約しますか？
            </p>
          ) : (
            <p>この時間には既に予約があります。それでも予約しますか？</p>
          )}
          <ul className="rform__conflicts">
            {(conflicts ?? []).map((c) => (
              <li key={c.id} className="micro">
                {fmtDateJa(c.starts_at)} {hhmm(jstHour(c.starts_at))} —{" "}
                {names[c.created_by] ?? "メンバー"}
                {c.is_exclusive ? "（貸切）" : "（相席OK）"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rform__actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "保存中" : hasConflicts ? "それでも予約する" : editing ? "更新する" : "予約する"}
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
