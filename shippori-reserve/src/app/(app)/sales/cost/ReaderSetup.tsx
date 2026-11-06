"use client";

import { useState, useTransition } from "react";
import { issueReaderToken } from "./actions";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * 毎朝の読み取り（定期実行のClaude）の合言葉。オーナーだけに出す。
 * 発行した合言葉はこの画面に1回だけ出る。Claude の設定フォーム（yoyaku.shipporitei.jp 用・x-api-key）に貼る。
 */
export default function ReaderSetup({ issuedAt, lastUsedAt }: { issuedAt: string | null; lastUsedAt: string | null }) {
  const [token, setToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const [sure, setSure] = useState(false);

  const issue = () =>
    start(async () => {
      setErr(null);
      const r = await issueReaderToken();
      if (r.ok) setToken(r.token);
      else setErr(r.error);
      setSure(false);
    });

  return (
    <details className="card micro">
      <summary>AIの読み取りの設定（オーナー）</summary>
      <div className="stack" style={{ marginTop: "0.6rem" }}>
        <p>
          毎朝、Claude（定期実行）が読み取り待ちの写真を取りに来て読みます。そのための合言葉です。
          {issuedAt ? `　発行：${fmt(issuedAt)}` : "　まだ発行していません。"}
          {lastUsedAt ? `　最後に使われた：${fmt(lastUsedAt)}` : ""}
        </p>
        {token ? (
          <>
            <p>
              <strong>この合言葉は今だけ表示されます。</strong>Claude の「認証情報」フォーム（yoyaku.shipporitei.jp）に貼ってください。LINEやチャットには貼らないでください。
            </p>
            <input className="field" readOnly value={token} aria-label="発行した合言葉" onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                navigator.clipboard.writeText(token).then(
                  () => setCopied(true),
                  () => setCopied(false),
                )
              }
            >
              {copied ? "コピーしました" : "コピー"}
            </button>
          </>
        ) : issuedAt && !sure ? (
          <button type="button" className="btn btn-sm" onClick={() => setSure(true)}>
            発行し直す
          </button>
        ) : (
          <>
            {issuedAt ? <p className="err">発行し直すと、今の合言葉は使えなくなります（Claude側の設定も貼り直しが必要）。</p> : null}
            <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={issue}>
              合言葉を発行する
            </button>
          </>
        )}
        {err ? <p className="err">{err}</p> : null}
      </div>
    </details>
  );
}
