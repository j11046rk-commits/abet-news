"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  createLedgerEntry,
  deleteLedgerEntry,
  postFixedCosts,
  updateLedgerEntry,
  upsertFixedCost,
} from "./actions";
import { parseYen, yen } from "@/lib/money";
import { fmtDate, nowJst } from "@/lib/time";
import {
  categoryJa,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  type FixedCost,
  type LedgerDirection,
  type LedgerEntry,
} from "@/lib/types";

export default function LedgerClient({
  isOwner,
  entries,
  fixedCosts,
  currentYm,
  names,
}: {
  isOwner: boolean;
  entries: LedgerEntry[];
  fixedCosts: FixedCost[];
  currentYm: string;
  /** profile_id → 表示名 */
  names: Record<string, string>;
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
  const [category, setCategory] = useState("rent");
  const [amount, setAmount] = useState(0);
  const [memo, setMemo] = useState("");

  function reset() {
    setEditingId(null);
    setOpen(false);
    setEntryDate(fmtDate(nowJst()));
    setDirection("expense");
    setCategory("rent");
    setAmount(0);
    setMemo("");
  }

  /** 行の「編集」を押したらフォームを開いて値を流し込む */
  function startEdit(e: LedgerEntry) {
    setEditingId(e.id);
    setEntryDate(e.entry_date);
    setDirection(e.direction);
    setCategory(e.category);
    setAmount(e.amount_yen);
    setMemo(e.memo ?? "");
    setOpen(true);
    setError(null);
    setFlash(null);
    // 一覧の下の方の行を編集するとき、フォームは画面外の上で開く。連れて行く。
    requestAnimationFrame(() =>
      formRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
  }

  const categories = direction === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  // 今月分の固定費が未計上かどうか（memo に固定費名が入っているかで判定）
  const postedNames = new Set(
    entries.filter((e) => e.entry_date.startsWith(currentYm)).map((e) => e.memo),
  );
  const unposted = fixedCosts.filter((c) => c.is_active && !postedNames.has(c.name));

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

  async function post() {
    setBusy(true);
    setError(null);
    const res = await postFixedCosts();
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "計上できませんでした。");
    setFlash(res.posted > 0 ? `${res.posted}件を計上しました` : "計上済みです");
    router.refresh();
  }

  return (
    <>
      {unposted.length > 0 ? (
        <div className="notice lsum__post">
          <p>
            今月分の固定費が {unposted.length}件 未計上です（
            {yen(unposted.reduce((s, c) => s + c.amount_yen, 0))}）。
          </p>
          <button className="btn btn-sm" onClick={post} disabled={busy}>
            計上する
          </button>
        </div>
      ) : null}

      {flash ? <p className="notice lsum__flash">{flash}</p> : null}
      {error ? <p className="err">{error}</p> : null}

      <div className="rule">
        <span className="label">Entries — {entries.length}</span>
      </div>

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
                    setCategory(d === "income" ? "rake" : "rent");
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
                メモ（任意）
              </label>
              <input
                id="l-memo"
                className="field"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
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

      {entries.length === 0 ? (
        <p className="empty">まだ記帳がありません。</p>
      ) : (
        <ul className="lrows">
          {entries.map((e) => (
            <li key={e.id} className="lrow">
              <span className="lrow__date amount">{e.entry_date.slice(5)}</span>
              <span className="lrow__cat">
                {categoryJa(e.direction, e.category)}
                {e.memo ? <span className="micro"> · {e.memo}</span> : null}
              </span>
              <span className={`lrow__amt amount${e.direction === "expense" ? " is-expense" : ""}`}>
                {e.direction === "expense" ? `−${yen(e.amount_yen)}` : yen(e.amount_yen)}
              </span>
              <span className="micro lrow__by">
                {e.created_by ? (names[e.created_by] ?? "—") : "—"}
                {e.session_id ? " · 卓から" : ""}
              </span>
              <span className="lrow__ops">
                {e.session_id ? null : (
                  <>
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
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <FixedCosts costs={fixedCosts} isOwner={isOwner} />
    </>
  );
}

/**
 * 毎月かかる費用は家賃だけ。金額と計上日をその場で直せるようにする。
 * 追加・削除は置かない（1件しかないものにボタンを増やさない）。
 */
function FixedCosts({ costs, isOwner }: { costs: FixedCost[]; isOwner: boolean }) {
  const router = useRouter();
  const rent = costs.find((c) => c.name === "家賃") ?? costs[0];

  const [amount, setAmount] = useState(rent?.amount_yen ?? 80000);
  const [day, setDay] = useState(rent?.billing_day ?? 27);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await upsertFixedCost({
      id: rent?.id,
      name: "家賃",
      amountYen: amount,
      billingDay: day,
      isActive: true,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setFlash("保存しました");
    router.refresh();
  }

  return (
    <>
      <div className="rule">
        <span className="label">Rent</span>
      </div>

      <p className="dim">
        毎月かかる費用です。台帳には「計上する」を押したときに載ります。
      </p>

      {isOwner ? (
        <form className="rentform" onSubmit={save}>
          <div>
            <label className="field-label" htmlFor="f-amt">
              家賃
            </label>
            <input
              id="f-amt"
              className="field field-num"
              inputMode="numeric"
              pattern="[0-9]*"
              value={amount === 0 ? "" : String(amount)}
              onChange={(e) => setAmount(Math.max(0, parseYen(e.target.value)))}
              required
            />
            <p className="micro amount">{yen(amount)}</p>
          </div>
          <div>
            <label className="field-label" htmlFor="f-day">
              計上日
            </label>
            <input
              id="f-day"
              type="number"
              min={1}
              max={28}
              className="field field-num"
              value={day}
              onChange={(e) => setDay(Math.min(28, Math.max(1, Number(e.target.value) || 1)))}
            />
            <p className="micro">毎月この日付で計上します</p>
          </div>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "保存中" : "保存する"}
          </button>
        </form>
      ) : (
        <p className="rentview">
          <span className="rentview__num amount">{yen(rent?.amount_yen ?? 0)}</span>
          <span className="micro">毎月 {rent?.billing_day ?? 27} 日に計上</span>
        </p>
      )}

      {error ? <p className="err">{error}</p> : null}
      {flash ? <p className="notice">{flash}</p> : null}
    </>
  );
}
