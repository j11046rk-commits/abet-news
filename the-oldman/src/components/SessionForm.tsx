"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import {
  createSession,
  deleteSession,
  updateSession,
  type SessionInput,
} from "@/app/(app)/sessions/actions";
import { parseYen, yen } from "@/lib/money";
import { fmtDate, fmtTime } from "@/lib/time";
import { GAME_TYPES, type GameType, type Player, type Session } from "@/lib/types";

/** よく使う金額。数字キーパッドを叩く回数を減らすためのクイックチップ。 */
const CHIPS = [1000, 3000, 5000, 10000];

export default function SessionForm({
  players,
  editing,
  editingPlayerIds,
  onDone,
  onCancel,
}: {
  players: Player[];
  editing?: Session | null;
  editingPlayerIds?: string[];
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();

  const [date, setDate] = useState(editing ? fmtDate(editing.started_at) : fmtDate(new Date()));
  const [startTime, setStartTime] = useState(editing ? fmtTime(editing.started_at) : "20:00");
  const [endTime, setEndTime] = useState(editing?.ended_at ? fmtTime(editing.ended_at) : "");
  const [gameType, setGameType] = useState<GameType>(editing?.game_type ?? "cash");
  const [rake, setRake] = useState(editing?.rake_yen ?? 0);
  const [note, setNote] = useState(editing?.note ?? "");

  const [picked, setPicked] = useState<string[]>(editingPlayerIds ?? []);
  const [guests, setGuests] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const matches = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return players
      .filter((p) => p.name.includes(q) && !picked.includes(p.id))
      .slice(0, 6);
  }, [query, players, picked]);

  const exactExists = useMemo(
    () => players.some((p) => p.name === query.trim()) || guests.includes(query.trim()),
    [query, players, guests],
  );

  function addPlayer(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setQuery("");
    searchRef.current?.focus();
  }

  function addGuest() {
    const name = query.trim();
    if (!name) return;
    setGuests((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setQuery("");
    searchRef.current?.focus();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const input: SessionInput = {
      date,
      startTime,
      endTime,
      gameType,
      rakeYen: rake,
      note,
      playerIds: picked,
      newGuests: guests,
    };

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

  const headcount = picked.length + guests.length;

  return (
    <form onSubmit={submit} className="rform">
      {/* 金額を最初に置く。卓が終わった直後に打ち込みたいのはこれ。 */}
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
        <div className="sform__chips">
          {CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              className="btn btn-sm"
              onClick={() => setRake((v) => v + c)}
            >
              +{c.toLocaleString("ja-JP")}
            </button>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => setRake(0)}>
            クリア
          </button>
        </div>
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
          <label className="field-label" htmlFor="s-type">
            種目
          </label>
          <select
            id="s-type"
            className="field"
            value={gameType}
            onChange={(e) => setGameType(e.target.value as GameType)}
          >
            {GAME_TYPES.map((g) => (
              <option key={g.value} value={g.value}>
                {g.ja}
              </option>
            ))}
          </select>
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
        <label className="field-label" htmlFor="s-player">
          参加者{headcount > 0 ? ` — ${headcount}名` : ""}
        </label>

        {headcount > 0 ? (
          <ul className="sform__picked">
            {picked.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  className="badge badge-brass sform__chip"
                  onClick={() => setPicked((prev) => prev.filter((x) => x !== id))}
                >
                  {byId.get(id)?.name ?? "?"} ×
                </button>
              </li>
            ))}
            {guests.map((g) => (
              <li key={g}>
                <button
                  type="button"
                  className="badge badge-outline sform__chip"
                  onClick={() => setGuests((prev) => prev.filter((x) => x !== g))}
                >
                  {g} ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <input
          id="s-player"
          ref={searchRef}
          className="field"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            // IME 変換確定の Enter で誤送信させない
            if (e.nativeEvent.isComposing) return;
            if (matches.length > 0) addPlayer(matches[0].id);
            else if (!exactExists) addGuest();
          }}
          placeholder="名前で検索"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />

        {query.trim() ? (
          <ul className="sform__matches">
            {matches.map((p) => (
              <li key={p.id}>
                <button type="button" className="sform__match" onClick={() => addPlayer(p.id)}>
                  {p.name}
                </button>
              </li>
            ))}
            {!exactExists ? (
              <li>
                <button type="button" className="sform__match is-new" onClick={addGuest}>
                  「{query.trim()}」を新規ゲストとして追加
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
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
