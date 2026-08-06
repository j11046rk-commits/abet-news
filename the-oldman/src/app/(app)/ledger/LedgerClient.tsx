"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { createLedgerEntry, deleteLedgerEntry, updateLedgerEntry } from "./actions";
import { parseYen, yen } from "@/lib/money";
import { fmtDate, nowJst } from "@/lib/time";
import {
  EXPENSE_CATEGORIES_ACTIVE,
  INCOME_CATEGORIES,
  categoryJa,
  type LedgerDirection,
  type PassbookRow,
} from "@/lib/types";

export default function LedgerClient({
  rows,
}: {
  /** 表示中の月の行。編集・削除はここから引く。 */
  rows: PassbookRow[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [entryDate, setEntryDate] = useState(fmtDate(nowJst()));
  const [direction, setDirection] = useState<LedgerDirection>("expense");
  const [category, setCategory] = useState("water");
  const [amount, setAmount] = useState(0);
  const [memo, setMemo] = useState("");

  function reset() {
    setEditingId(null);
    setOpen(false);
    setEntryDate(fmtDate(nowJst()));
    setDirection("expense");
    setCategory("water");
    setAmount(0);
    setMemo("");
  }

  /** 手で直せる行だけを一覧に出す。自動起票の行はここに並べない。 */
  const editable = rows.filter((r) => !r.session_id && !r.fixed_cost_id && !r.advance_id);

  function startEdit(e: PassbookRow) {
    setEditingId(e.id);
    setEntryDate(e.entry_date);
    setDirection(e.direction);
    setCategory(e.category);
    setAmount(e.amount_yen);
    setMemo(e.memo ?? "");
    setOpen(true);
    setError(null);
    setFlash(null);
    requestAnimationFrame(() =>
      formRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
  }

  const categories = direction === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES_ACTIVE;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const input = { entryDate, direction, category, amountYen: amount, memo };
    const res = editingId
      ? await updateLedgerEntry(editingId, input)
      : await createLedgerEntry(input);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    const wasEditing = Boolean(editingId);
    reset();
    setFlash(wasEditing ? "更新しました" : "記帳しました");
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    const res = await deleteLedgerEntry(id);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    if (editingId === id) reset();
    setFlash("削除しました");
    router.refresh();
  }

  return (
    <>
      {flash ? <p className="notice lsum__flash">{flash}</p> : null}
      {error ? <p className="err">{error}</p> : null}

      {open ? (
        <form className="surface rform" onSubmit={submit} ref={formRef}>
          {editingId ? <p className="label lform__editing">編集中</p> : null}
          <div className="rform__row2">
            <div>
              <label className="field-label" htmlFor="l-date">
                日付
              </label>
              <input
                id="l-date"
                type="date"
                className="field field-num"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="field-label" htmlFor="l-dir">
                区分
              </label>
              <select
                id="l-dir"
                className="field"
                value={direction}
                onChange={(e) => {
                  const d = e.target.value as LedgerDirection;
                  setDirection(d);
                  setCategory(d === "income" ? "rake" : "water");
                }}
              >
                <option value="income">収入</option>
                <option value="expense">支出</option>
              </select>
            </div>
          </div>

          <div className="rform__row2">
            <div>
              <label className="field-label" htmlFor="l-cat">
                カテゴリ
              </label>
              <select
                id="l-cat"
                className="field"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.ja}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="l-amt">
                金額
              </label>
              <input
                id="l-amt"
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

          <div>
            <label className="field-label" htmlFor="l-memo">
              名目（任意）
            </label>
            <input
              id="l-memo"
              className="field"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="通帳に出る名前。空ならカテゴリ名"
            />
          </div>

          <div className="rform__actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "保存中" : editingId ? "更新する" : "記帳する"}
            </button>
            <button type="button" className="btn" onClick={reset} disabled={busy}>
              やめる
            </button>
          </div>
        </form>
      ) : (
        <button className="btn block" onClick={() => setOpen(true)}>
          記帳する
        </button>
      )}

      {editable.length > 0 ? (
        <details className="lfix">
          <summary className="micro">この月の記帳を直す — {editable.length}件</summary>
          <ul className="lfix__list">
            {editable.map((e) => (
              <li key={e.id}>
                <span className="lfix__date amount">{e.entry_date.slice(5)}</span>
                <span className="lfix__name">
                  {e.memo?.trim() || categoryJa(e.direction, e.category)}
                </span>
                <span className={`lfix__amt amount${e.direction === "expense" ? " is-expense" : ""}`}>
                  {yen(e.amount_yen)}
                </span>
                <button className="btn btn-sm" disabled={busy} onClick={() => startEdit(e)}>
                  編集
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  disabled={busy}
                  onClick={() => remove(e.id)}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

    </>
  );
}
