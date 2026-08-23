"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login_id: loginId, password }),
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(body.error ?? "ログインできませんでした。");
      setBusy(false);
      return;
    }

    /*
     * 戻り先はこのサイトの中だけ。next はURLに載って外から差し替えられるので、
     * 検査せずに使うと「本物のログイン画面で入力→偽サイトへ着地」の踏み台になる。
     * 「/で始まり //ではない」以外はホームへ。
     */
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    router.replace(body.must_change_password ? "/password" : safeNext);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="gate__form">
      <div>
        <label className="field-label" htmlFor="login_id">
          ログインID
        </label>
        <input
          id="login_id"
          name="login_id"
          className="field"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />
      </div>

      <div>
        <label className="field-label" htmlFor="password">
          パスワード
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="field"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>

      {error ? <p className="err">{error}</p> : null}

      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? "確認中" : "ログイン"}
      </button>
    </form>
  );
}
