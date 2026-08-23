"use client";

import { useState } from "react";

/**
 * 予約のキャンセル（ログイン不要）。入口は2つ。
 *
 * 1. 完了画面のリンク（?t=合言葉）——推測できない値なので、そのまま押せば確認だけで済む
 * 2. 予約番号＋電話番号——リンクを控え忘れた人向け。番号は連番で秘密にならないので、
 *    電話番号との一致で本人確認する（回数制限つき）
 *
 * リンクの経路を足しても、こちらは残す。控え忘れた人が電話でしか
 * キャンセルできないと、その多くが当日の無断キャンセルに化けてしまう。
 */
export default function NetCancel({ token }: { token?: string }) {
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
        body: JSON.stringify(token ? { token } : { reference, phone }),
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
          {reference.trim() ? `ご予約（${reference.trim().toUpperCase()}）を` : "ご予約を"}
          キャンセルしました。またのご利用をお待ちしております。
        </p>
        <p className="net__note"><a href="/yoyaku">新しく予約する</a></p>
      </div>
    );
  }

  // リンクから来た場合。番号も電話番号も要らないので、押し間違い防止の確認だけ置く。
  if (token) {
    return (
      <div className="net__card">
        <h2 className="net__step-title">ご予約のキャンセル</h2>
        <p className="net__hint">
          このリンクのご予約をキャンセルします。よろしければ下のボタンを押してください。
          開始2時間前を過ぎている場合は お電話（<a href="tel:0897474494">0897-47-4494</a>）でお願いします。
        </p>
        {error && <p className="net__error">{error}</p>}
        <button
          className="btn btn-primary net__confirm-btn"
          disabled={sending}
          onClick={submit}
        >
          {sending ? "手続き中…" : "この予約をキャンセルする"}
        </button>
        <p className="net__foot"><a href="/yoyaku">← 予約ページに戻る</a></p>
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
      <input id="nc-phone" className="field" value={phone} type="tel" inputMode="tel" maxLength={20}
        onChange={(e) => setPhone(e.target.value)} onInput={(e) => setPhone(e.currentTarget.value)}
        placeholder="例）090-1234-5678" autoComplete="tel" />
      {error && <p className="net__error">{error}</p>}
      <button
        className="btn btn-primary net__confirm-btn"
        disabled={sending || reference.trim() === "" || phone.replace(/[^0-9+]/g, "").length < 10}
        onClick={submit}
      >
        {sending ? "確認中…" : "この予約をキャンセルする"}
      </button>
      <p className="net__foot"><a href="/yoyaku">← 予約ページに戻る</a></p>
    </div>
  );
}
