"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createLedgerEntry,
  deleteFixedCost,
  deleteLedgerEntry,
  postFixedCosts,
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
}: {
  isOwner: boolean;
  entries: LedgerEntry[];
  fixedCosts: FixedCost[];
  currentYm: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [entryDate, setEntryDate] = useState(fmtDate(nowJst()));
  const [direction, setDirection] = useState<LedgerDirection>("expense");
  const [category, setCategory] = useState("rent");
  const [amount, setAmount] = useState(0);
  const [memo, setMemo] = useState("");

  const categories = direction === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  // 当月ぶんの固定費が未計上かどうか（memo に固定費名が入っているかで判定）
  const postedNames = new Set(
    entries.filter((e) => e.entry_date.startsWith(currentYm)).map((e) => e.memo),
  );
  const unposted = fixedCosts.filter((c) => c.is_active && !postedNames.has(c.name));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await createLedgerEntry({ entryDate, direction, category, amountYen: amount, memo });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setAmount(0);
    setMemo("");
    setOpen(false);
    setFlash("記帳しました");
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    const res = await deleteLedgerEntry(id);
    setBusy(false);
    if (!res.ok) return setError(res.error);
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
      {isOwner && unposted.length > 0 ? (
        <div className="notice lsum__post">
          <p>
            今月ぶんの固定費が {unposted.length}件 未計上です（
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

      {isOwner ? (
        open ? (
          <form className="surface rform" onSubmit={submit}>
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
                {busy ? "記帳中" : "記帳する"}
              </button>
              <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>
                やめる
              </button>
            </div>
          </form>
        ) : (
          <button className="btn block" onClick={() => setOpen(true)}>
            記帳する
          </button>
        )
      ) : null}

      {entries.length === 0 ? (
        <p className="empty">まだ記帳がありません。</p>
      ) : (
        <table className="table ltable">
          <thead>
            <tr>
              <th>日付</th>
              <th>カテゴリ</th>
              <th className="ta-r">金額</th>
              {isOwner ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="amount ltable__date">{e.entry_date.slice(5)}</td>
                <td>
                  {categoryJa(e.direction, e.category)}
                  {e.memo ? <span className="micro"> · {e.memo}</span> : null}
                  {e.session_id ? <span className="micro"> · 卓から自動</span> : null}
                </td>
                <td className={`ta-r amount${e.direction === "expense" ? " is-expense" : ""}`}>
                  {e.direction === "expense" ? `−${yen(e.amount_yen)}` : yen(e.amount_yen)}
                </td>
                {isOwner ? (
                  <td className="ta-r">
                    {e.session_id ? (
                      <span className="micro">—</span>
                    ) : (
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={busy}
                        onClick={() => remove(e.id)}
                      >
                        削除
                      </button>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <FixedCosts costs={fixedCosts} isOwner={isOwner} />
    </>
  );
}

function FixedCosts({ costs, isOwner }: { costs: FixedCost[]; isOwner: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState(0);
  const [day, setDay] = useState(27);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await upsertFixedCost({ name, amountYen: amount, billingDay: day, isActive: true });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setName("");
    setAmount(0);
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    const res = await deleteFixedCost(id);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }

  const total = costs.filter((c) => c.is_active).reduce((s, c) => s + c.amount_yen, 0);

  return (
    <>
      <div className="rule">
        <span className="label">Fixed costs</span>
      </div>

      <p className="dim">
        毎月かかる費用です。合計 <span className="amount">{yen(total)}</span> / 月。
      </p>

      <table className="table">
        <thead>
          <tr>
            <th>名称</th>
            <th className="ta-r">金額</th>
            <th className="ta-r">計上日</th>
            {isOwner ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {costs.length === 0 ? (
            <tr>
              <td colSpan={isOwner ? 4 : 3} className="empty">
                固定費が登録されていません。
              </td>
            </tr>
          ) : (
            costs.map((c) => (
              <tr key={c.id} className={c.is_active ? undefined : "is-off"}>
                <td>{c.name}</td>
                <td className="ta-r amount">{yen(c.amount_yen)}</td>
                <td className="ta-r amount">{c.billing_day}日</td>
                {isOwner ? (
                  <td className="ta-r">
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={busy}
                      onClick={() => remove(c.id)}
                    >
                      削除
                    </button>
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {isOwner ? (
        <form className="fixedadd" onSubmit={add}>
          <div>
            <label className="field-label" htmlFor="f-name">
              名称
            </label>
            <input
              id="f-name"
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="家賃"
              required
            />
          </div>
          <div>
            <label className="field-label" htmlFor="f-amt">
              金額
            </label>
            <input
              id="f-amt"
              className="field field-num"
              inputMode="numeric"
              pattern="[0-9]*"
              value={amount === 0 ? "" : String(amount)}
              onChange={(e) => setAmount(Math.max(0, parseYen(e.target.value)))}
              placeholder="0"
              required
            />
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
          </div>
          <button type="submit" className="btn" disabled={busy}>
            追加
          </button>
          {error ? <p className="err">{error}</p> : null}
        </form>
      ) : null}
    </>
  );
}
