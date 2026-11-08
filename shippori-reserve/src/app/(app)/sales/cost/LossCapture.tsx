"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { shrinkImage } from "@/lib/image";
import { addLossPhotos } from "./actions";

/**
 * 捨てたものを撮るだけ（店長・毎日）。グループLINEに上げていた写真の代わり（店主指示 2026-11-09）。
 * 品名・金額の目安は毎朝の読み取り役（サブスクのClaude）が入れる。ひとことがあると見積もりが正確になる。
 */
export default function LossCapture() {
  const router = useRouter();
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onFiles = async (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (files.length === 0) return;
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const fd = new FormData();
      for (const f of files.slice(0, 10)) fd.append("file", await shrinkImage(f, 1600, 0.8));
      fd.set("memo", memo);
      const r = await addLossPhotos(fd);
      if (!r.ok) setErr(r.error);
      else {
        setMsg(`${r.added}枚を保存しました。明朝AIが品名と金額の目安を入れます。`);
        setMemo("");
        router.refresh();
      }
    } catch {
      setErr("送れませんでした。電波の良いところでもう一度お試しください。");
    } finally {
      setBusy(false);
      if (cam.current) cam.current.value = "";
      if (lib.current) lib.current.value = "";
    }
  };

  return (
    <section className="card stack" aria-label="捨てたものを撮る">
      <h2 className="section-title">🗑 今日捨てたもの</h2>
      <input
        className="field"
        aria-label="ひとこと"
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        placeholder="ひとこと（任意）例：唐揚げ3人前・作りすぎ"
      />
      <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => cam.current?.click()}>
        {busy ? "送信中…" : "📷 捨てたものを撮る"}
      </button>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => lib.current?.click()}>
        保存した写真から選ぶ
      </button>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden aria-label="捨てたものを撮る（カメラ）" onChange={(e) => onFiles(e.target.files)} />
      <input ref={lib} type="file" accept="image/*" multiple hidden aria-label="捨てたものの写真を選ぶ" onChange={(e) => onFiles(e.target.files)} />
      <p className="micro">写真だけでOK（グループLINEの代わり）。量が分かるように撮ってください。金額は翌朝AIが仕入値で見積もります。</p>
      {msg ? <p className="notice micro">{msg}</p> : null}
      {err ? <p className="err">{err}</p> : null}
    </section>
  );
}
