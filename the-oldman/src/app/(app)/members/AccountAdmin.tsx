"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { yen } from "@/lib/money";

type Account = {
  id: string;
  login_id: string;
  display_name: string;
  role: "owner" | "member";
  is_active: boolean;
  must_change_password: boolean;
  investment_yen: number;
};

export default function AccountAdmin({ accounts, meId }: { accounts: Account[]; meId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"owner" | "member">("member");
  const [investment, setInvestment] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 初期パスワードは一度だけ表示する。閉じたら二度と見られない。 */
  const [issued, setIssued] = useState<{ login_id: string; password: string } | null>(null);

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        login_id: loginId,
        display_name: displayName,
        role,
        investment_yen: investment,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) return setError(body.error ?? "発行できませんでした。");

    setIssued({ login_id: body.login_id, password: body.password });
    setLoginId("");
    setDisplayName("");
    setRole("member");
    setInvestment(0);
    setOpen(false);
    router.refresh();
  }

  async function patch(id: string, payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "更新できませんでした。");
    router.refresh();
  }

  async function reset(a: Account) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/accounts/${a.id}/reset-password`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "再発行できませんでした。");
    setIssued({ login_id: a.login_id, password: body.password });
    router.refresh();
  }

  return (
    <>
      <div className="rule">
        <span className="label">Accounts</span>
      </div>

      {issued ? (
        <div className="notice issued">
          <p className="label">初期パスワード — この画面を閉じると二度と表示されません</p>
          <p className="issued__pair">
            <span className="micro">ログインID</span>
            <span className="amount issued__value">{issued.login_id}</span>
          </p>
          <p className="issued__pair">
            <span className="micro">パスワード</span>
            <span className="amount issued__value">{issued.password}</span>
          </p>
          <p className="micro">本人に手渡してください。初回ログイン時に変更を求めます。</p>
          <button className="btn btn-sm" onClick={() => setIssued(null)}>
            控えました
          </button>
        </div>
      ) : null}

      {error ? <p className="err">{error}</p> : null}

      {open ? (
        <form className="surface rform" onSubmit={issue}>
          <div className="rform__row2">
            <div>
              <label className="field-label" htmlFor="a-login">
                ログインID
              </label>
              <input
                id="a-login"
                className="field"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="santiago"
                required
              />
              <p className="micro">半角英小文字・数字・. _ -</p>
            </div>
            <div>
              <label className="field-label" htmlFor="a-name">
                表示名
              </label>
              <input
                id="a-name"
                className="field"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="rform__row2">
            <div>
              <label className="field-label" htmlFor="a-role">
                ロール
              </label>
              <select
                id="a-role"
                className="field"
                value={role}
                onChange={(e) => setRole(e.target.value as "owner" | "member")}
              >
                <option value="member">メンバー</option>
                <option value="owner">オーナー</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="a-inv">
                出資額
              </label>
              <input
                id="a-inv"
                type="number"
                inputMode="numeric"
                min={0}
                step={1000}
                className="field field-num"
                value={investment}
                onChange={(e) => setInvestment(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
          </div>

          <div className="rform__actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "発行中" : "発行する"}
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>
              やめる
            </button>
          </div>
        </form>
      ) : (
        <button className="btn block" onClick={() => setOpen(true)}>
          アカウントを発行
        </button>
      )}

      <table className="table accounts">
        <thead>
          <tr>
            <th>ログインID</th>
            <th>表示名</th>
            <th>ロール</th>
            <th className="ta-r">操作</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id} className={a.is_active ? undefined : "is-off"}>
              <td className="amount">{a.login_id}</td>
              <td>
                {a.display_name}
                <br />
                <span className="micro">{yen(a.investment_yen)}</span>
                {a.must_change_password ? <span className="micro"> · 初期PW</span> : null}
                {!a.is_active ? <span className="micro"> · 無効</span> : null}
              </td>
              <td>
                <select
                  className="field field-sm"
                  value={a.role}
                  disabled={busy || a.id === meId}
                  onChange={(e) => patch(a.id, { role: e.target.value })}
                >
                  <option value="member">メンバー</option>
                  <option value="owner">オーナー</option>
                </select>
              </td>
              <td className="ta-r accounts__ops">
                <button className="btn btn-sm" disabled={busy} onClick={() => reset(a)}>
                  PW再発行
                </button>
                {a.id === meId ? null : (
                  <button
                    className={`btn btn-sm${a.is_active ? " btn-danger" : ""}`}
                    disabled={busy}
                    onClick={() => patch(a.id, { is_active: !a.is_active })}
                  >
                    {a.is_active ? "無効化" : "有効化"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
