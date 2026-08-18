"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABEL } from "@/lib/constants";
import type { Profile, UserRole } from "@/lib/types";

const ROLES: UserRole[] = ["owner", "manager", "staff", "viewer"];

/**
 * 初期パスワードは発行時に1度だけ画面に出す。DBにも平文では残らない。
 * 口頭で本人に渡し、本人が初回ログインで変更する。
 */
export default function AccountAdmin({ profiles, meId }: { profiles: Profile[]; meId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ login_id: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  /*
   * 取り返しのつかない操作の前に一度だけ聞く。
   *
   * パスワードの再発行は元に戻せない——押した瞬間に本人のパスワードが変わり、
   * 新しいものを伝えるまでその人はログインできない。9人ぶんのボタンが
   * 指1本ぶんの間隔で並ぶ画面なので、隣を押し間違えたら誰かが締め出される。
   * しかも押した側は気づかない（画面には新しいパスワードが出るだけ）。
   *
   * 停止は戻せるが、シフト中の人を突然締め出すので同じく一度聞く。
   */
  const [ask, setAsk] = useState<{ kind: "reset" | "deactivate"; p: Profile } | null>(null);

  const [loginId, setLoginId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<UserRole>("staff");
  const [isOwnerContact, setIsOwnerContact] = useState(false);

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "処理できませんでした。");
      return null;
    }
    router.refresh();
    return json;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const json = await call("/api/accounts", "POST", {
      login_id: loginId,
      display_name: displayName,
      role,
      is_owner_contact: isOwnerContact,
    });
    if (!json) return;
    setIssued({ login_id: json.login_id, password: json.initial_password });
    setLoginId("");
    setDisplayName("");
    setRole("staff");
    setIsOwnerContact(false);
    setOpen(false);
  }

  async function reset(p: Profile) {
    const json = await call(`/api/accounts/${p.id}/reset-password`, "POST");
    if (!json) return;
    setIssued({ login_id: p.login_id, password: json.initial_password });
  }

  return (
    <div className="stack">
      {issued ? (
        <section className="notice notice-strong">
          <p style={{ margin: 0 }}>
            <strong>{issued.login_id}</strong> の初期パスワード
          </p>
          <p
            style={{
              margin: "0.4rem 0",
              fontSize: "1.4rem",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "0.06em",
            }}
          >
            {issued.password}
          </p>
          <p className="micro" style={{ margin: 0 }}>
            この画面を閉じると二度と表示できません。本人に口頭で伝えてください。
            本人は初回ログイン時に必ず変更させられます。
          </p>
          <button className="btn btn-sm" style={{ marginTop: "0.6rem" }} onClick={() => setIssued(null)}>
            控えました
          </button>
        </section>
      ) : null}

      {error ? <p className="err">{error}</p> : null}

      <button className="btn btn-primary btn-block" onClick={() => setOpen((v) => !v)}>
        {open ? "閉じる" : "＋ スタッフを追加"}
      </button>

      {open ? (
        <form className="card stack" onSubmit={create}>
          <div>
            <label className="field-label" htmlFor="new_login_id">
              ログインID（半角英字。姓のローマ字を推奨）
            </label>
            <input
              id="new_login_id"
              className="field"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value.toLowerCase())}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </div>
          <div>
            <label className="field-label" htmlFor="new_display_name">
              表示名
            </label>
            <input
              id="new_display_name"
              className="field"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="field-label" htmlFor="new_role">
              ロール
            </label>
            <select
              id="new_role"
              className="field"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <label className="switch">
            <span>
              「オーナー直接」の選択肢に出す
              <span className="micro" style={{ display: "block" }}>
                誰経由の予約かを数えるための印
              </span>
            </span>
            <input
              type="checkbox"
              checked={isOwnerContact}
              onChange={(e) => setIsOwnerContact(e.target.checked)}
            />
          </label>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            発行する
          </button>
        </form>
      ) : null}

      <div className="list">
        {profiles.map((p) => (
          <article key={p.id} className="card">
            <div className="row" style={{ flexWrap: "wrap" }}>
              <strong>{p.display_name}</strong>
              <span className="muted">{p.login_id}</span>
              <span className="badge">{ROLE_LABEL[p.role]}</span>
              {p.is_owner_contact ? <span className="badge badge--source">直通</span> : null}
              {!p.is_active ? <span className="badge badge--cancelled">停止中</span> : null}
              {p.must_change_password ? <span className="badge badge--tentative">初回PW</span> : null}
            </div>

            <div className="chips" style={{ marginTop: "0.7rem" }}>
              <select
                className="field"
                style={{ width: "auto" }}
                value={p.role}
                disabled={busy || p.id === meId}
                onChange={(e) => call(`/api/accounts/${p.id}`, "PATCH", { role: e.target.value })}
                aria-label={`${p.display_name} のロール`}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>

              <button
                className="btn btn-sm"
                disabled={busy}
                onClick={() =>
                  call(`/api/accounts/${p.id}`, "PATCH", {
                    is_owner_contact: !p.is_owner_contact,
                  })
                }
              >
                {p.is_owner_contact ? "直通から外す" : "直通に入れる"}
              </button>

              <button
                className="btn btn-sm"
                disabled={busy}
                onClick={() => setAsk({ kind: "reset", p })}
              >
                パスワード再発行
              </button>

              {p.id !== meId ? (
                <button
                  className={`btn btn-sm ${p.is_active ? "btn-danger" : ""}`}
                  disabled={busy}
                  onClick={() =>
                    p.is_active
                      ? setAsk({ kind: "deactivate", p })
                      : call(`/api/accounts/${p.id}`, "PATCH", { is_active: true })
                  }
                >
                  {p.is_active ? "停止する" : "再開する"}
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      <p className="micro">
        停止したアカウントは、その瞬間から予約を読むことも書くこともできなくなります（DBのRLSで拒否）。
        記録を残すため、行の削除はしません。
      </p>

      {ask ? (
        <div className="veil" role="dialog" aria-modal="true" aria-label="確認">
          <div className="veil__card">
            {ask.kind === "reset" ? (
              <p style={{ margin: "0 0 0.9rem", lineHeight: 1.7 }}>
                <strong>{ask.p.display_name}</strong> さんのパスワードを再発行します。
                <br />
                いまのパスワードは<strong>使えなくなります</strong>。
                <br />
                新しいパスワードをご本人に伝えられますか？
              </p>
            ) : (
              <p style={{ margin: "0 0 0.9rem", lineHeight: 1.7 }}>
                <strong>{ask.p.display_name}</strong> さんのアカウントを停止します。
                <br />
                その瞬間からログインできなくなります（あとで再開できます）。
              </p>
            )}
            <div className="row" style={{ gap: "0.5rem" }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={busy}
                onClick={() => {
                  const a = ask;
                  setAsk(null);
                  if (a.kind === "reset") reset(a.p);
                  else call(`/api/accounts/${a.p.id}`, "PATCH", { is_active: false });
                }}
              >
                {ask.kind === "reset" ? "再発行する" : "停止する"}
              </button>
              <button type="button" className="btn" style={{ flex: 1 }} onClick={() => setAsk(null)}>
                やめる
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
