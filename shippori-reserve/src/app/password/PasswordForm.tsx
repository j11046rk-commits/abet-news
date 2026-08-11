"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const MIN = 8;

export default function PasswordForm({ first }: { first: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN) {
      setError(`パスワードは${MIN}文字以上にしてください。`);
      return;
    }
    if (password !== confirm) {
      setError("確認用のパスワードが一致しません。");
      return;
    }

    setBusy(true);
    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password, current }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(body.error ?? "変更できませんでした。");
      return;
    }

    setDone(true);
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="gate__form">
      {/* 初回（お店から渡されたパスワードを打ち替えるとき）は、
          たったいまログインで同じものを打った直後なので聞かない。 */}
      {!first ? (
        <div>
          <label className="field-label" htmlFor="current_password">
            いま使っているパスワード
          </label>
          <input
            id="current_password"
            type="password"
            className="field"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
      ) : null}

      <div>
        <label className="field-label" htmlFor="new_password">
          新しいパスワード（{MIN}文字以上）
        </label>
        <input
          id="new_password"
          type="password"
          className="field"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>

      <div>
        <label className="field-label" htmlFor="confirm_password">
          確認のためもう一度
        </label>
        <input
          id="confirm_password"
          type="password"
          className="field"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>

      {error ? <p className="err">{error}</p> : null}

      <button type="submit" className="btn btn-primary btn-block" disabled={busy || done}>
        {busy ? "変更中" : done ? "変更しました" : "変更する"}
      </button>

      {!first ? (
        <a className="btn btn-ghost btn-block" href="/settings">
          戻る
        </a>
      ) : null}
    </form>
  );
}
