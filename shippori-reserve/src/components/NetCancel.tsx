"use client";

import { useState } from "react";

/** 予約番号＋電話番号で本人確認してキャンセルする（ログイン不要） */
export default function NetCancel() {
  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/public/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reference, phone }),
      });
      const data = await res.json();
      if (data.ok) setDone(true);
      else setError(data.error ?? "キャンセルできませんでした。");
    } catch {
      setError("通信に失敗しました。もう一度お試しください。");
    }
    setSending(false);
  };

  if (done) {
    return (
      <div className="net__card net__done">
        <p className="net__done-mark">✅</p>
        <h2>キャンセルを承りました</h2>
        <p className="net__done-lead">
          ご予約（{reference.trim().toUpperCase()}）をキャンセルしました。
          またのご利用をお待ちしております。
        </p>
        <p className="net__note"><a href="/yoyaku">新しく予約する</a></p>
      </div>
    );
  }

  return (
    <div className="net__card">
      <h2 className="net__step-title">ご予約のキャンセル</h2>
      <p className="net__hint">
        ご予約完了時にお伝えした<b>予約番号</b>と、ご予約時の<b>電話番号</b>をご入力ください。
        開始2時間前を過ぎたキャンセルは お電話（<a href="tel:0897474494">0897-47-4494</a>）でお願いします。
      </p>
      <label className="net__label" htmlFor="nc-ref">予約番号 <em>必須</em></label>
      <input id="nc-ref" className="field" value={reference} maxLength={16}
        onChange={(e) => setReference(e.target.value)} placeholder="例）R-2608-0038"
        autoCapitalize="characters" autoComplete="off" />
      <label className="net__label" htmlFor="nc-phone">電話番号 <em>必須</em></label>
      <input id="nc-phone" className="field" value={phone} inputMode="tel" maxLength={13}
        onChange={(e) => setPhone(e.target.value)} placeholder="例）090-1234-5678" autoComplete="tel" />
      {error && <p className="net__error">{error}</p>}
      <button
        className="btn btn-primary net__confirm-btn"
        disabled={sending || reference.trim() === "" || phone.replace(/[^0-9]/g, "").length < 10}
        onClick={submit}
      >
        {sending ? "確認中…" : "この予約をキャンセルする"}
      </button>
      <p className="net__foot"><a href="/yoyaku">← 予約ページに戻る</a></p>
    </div>
  );
}
