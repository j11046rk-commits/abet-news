"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function PasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (pw.length < 8) return setError("パスワードは8文字以上にしてください。");
    if (pw !== pw2) return setError("2つのパスワードが一致しません。");

    setBusy(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) return setError(body.error ?? "変更できませんでした。");

    setDone(true);
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="gate__form">
      <div>
        <label className="field-label" htmlFor="pw">
          新しいパスワード
        </label>
        <input
          id="pw"
          type="password"
          className="field"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
        <p className="micro">8文字以上</p>
      </div>

      <div>
        <label className="field-label" htmlFor="pw2">
          確認のため再入力
        </label>
        <input
          id="pw2"
          type="password"
          className="field"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>

      {error ? <p className="err">{error}</p> : null}

      <button type="submit" className="btn btn-primary gate__submit" disabled={busy || done}>
        {done ? "変更しました" : busy ? "変更中" : "変更する"}
      </button>

      {!forced ? (
        <Link href="/" className="micro gate__foot">
          変更せずに戻る
        </Link>
      ) : null}
    </form>
  );
}
