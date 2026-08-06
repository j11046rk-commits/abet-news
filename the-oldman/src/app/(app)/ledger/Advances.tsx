"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createAdvance, deleteAdvance, setAdvanceSettled } from "./actions";
import { parseYen, yen } from "@/lib/money";
import { fmtDate, nowJst } from "@/lib/time";
import type { Advance } from "@/lib/types";

/**
 * 立替メモ。
 *
 * 台帳とは別に置いている。立替は施設の収支を動かさない — 動くのは精算したときで、
 * それは台帳に記帳される。ここに書くのは「誰にいくら返すのか」を忘れないため。
 */
export default function Advances({
  advances,
  profiles,
  meId,
}: {
  advances: Advance[];
  profiles: { id: string; name: string }[];
  meId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [profileId, setProfileId] = useState(meId);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState(0);
  const [dueOn, setDueOn] = useState("");

  const names = Object.fromEntries(profiles.map((p) => [p.id, p.name]));
  const openRows = advances.filter((a) => !a.settled_at);
  const doneRows = advances.filter((a) => a.settled_at);
  const outstanding = openRows.reduce((s, a) => s + a.amount_yen, 0);
  const today = fmtDate(nowJst());

  function reset() {
    setOpen(false);
    setProfileId(meId);
    setTitle("");
    setAmount(0);
    setDueOn("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await createAdvance({ profileId, title, amountYen: amount, dueOn: dueOn || null });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    reset();
    router.refresh();
  }

  async function toggle(a: Advance) {
    setBusy(true);
    const res = await setAdvanceSettled(a.id, !a.settled_at);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    const res = await deleteAdvance(id);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }

  return (
    <>
      <div className="rule">
        <span className="label">Advances</span>
        {outstanding > 0 ? (
          <span className="micro amount adv__total">未精算 {yen(outstanding)}</span>
        ) : null}
      </div>

      <p className="dim">
        立替分のメモです。
        <span className="micro">精算のチェックを入れると、台帳に支出として載ります。</span>
      </p>

      {error ? <p className="err">{error}</p> : null}

      {open ? (
        <form className="surface rform" onSubmit={submit}>
          <div className="rform__row2">
            <div>
              <label className="field-label" htmlFor="a-who">
                立て替えた人
              </label>
              <select
                id="a-who"
                className="field"
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="a-amt">
                金額
              </label>
              <input
                id="a-amt"
                className="field field-num"
                inputMode="numeric"
                pattern="[0-9]*"
                value={amount === 0 ? "" : String(amount)}
                onChange={(e) => setAmount(Math.max(0, parseYen(e.target.value)))}
                placeholder="0"
                required
              />
            </div>
          </div>

          <div className="rform__row2">
            <div>
              <label className="field-label" htmlFor="a-title">
                名目
              </label>
              <input
                id="a-title"
                className="field"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="チップの補充"
                required
              />
            </div>
            <div>
              <label className="field-label" htmlFor="a-due">
                精算予定日（任意）
              </label>
              <input
                id="a-due"
                type="date"
                className="field field-num"
                value={dueOn}
                onChange={(e) => setDueOn(e.target.value)}
              />
            </div>
          </div>

          <div className="rform__actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "保存中" : "追加する"}
            </button>
            <button type="button" className="btn" onClick={reset} disabled={busy}>
              やめる
            </button>
          </div>
        </form>
      ) : (
        <button className="btn block" onClick={() => setOpen(true)}>
          立替を追加
        </button>
      )}

      {advances.length === 0 ? (
        <p className="empty">立替の記録はありません。</p>
      ) : (
        <ul className="advs">
          {[...openRows, ...doneRows].map((a) => (
            <li key={a.id} className={`adv${a.settled_at ? " is-done" : ""}`}>
              <label className="adv__check">
                <input
                  type="checkbox"
                  checked={Boolean(a.settled_at)}
                  disabled={busy}
                  onChange={() => toggle(a)}
                />
                <span className="adv__box" aria-hidden />
                <span className="sr-only">精算済みにする</span>
              </label>
              <span className="adv__body">
                <span className="adv__title">{a.title}</span>
                <span className="micro adv__meta">
                  {names[a.profile_id] ?? "—"}
                  {a.due_on ? ` · ${a.settled_at ? "予定" : "期限"} ${a.due_on.slice(5)}` : ""}
                  {/* 期限を過ぎた未精算だけは色を変えて前に出す */}
                  {!a.settled_at && a.due_on && a.due_on < today ? (
                    <span className="adv__over"> 超過</span>
                  ) : null}
                </span>
              </span>
              <span className="adv__amt amount">{yen(a.amount_yen)}</span>
              <button
                className="btn btn-sm btn-danger adv__del"
                disabled={busy}
                onClick={() => remove(a.id)}
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
