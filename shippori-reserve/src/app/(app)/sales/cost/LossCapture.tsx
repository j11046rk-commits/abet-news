"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { shrinkImage } from "@/lib/image";
import { addLossPhotos } from "./actions";

/**
 * ロス（廃棄・まかない）を撮るだけ（スタッフも）。グループLINEに上げていた写真の代わり（店主指示 2026-11-09）。
 * まかないで使った分もロス。品名・金額の目安は毎朝の読み取り役（サブスクのClaude）が入れる。ひとことは任意。
 */
export default function LossCapture() {
  const router = useRouter();
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);
  const [memo, setMemo] = useState("");
  const [note, setNote] = useState(false);
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
        setMsg(`${r.added}枚 保存（明朝AIが金額を入れます）`);
        setMemo("");
        setNote(false);
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
    <div className="snap__col">
      <button type="button" className="snap__tile snap__tile--loss" disabled={busy} onClick={() => cam.current?.click()}>
        <span className="snap__icon" aria-hidden>🗑</span>
        <span className="snap__name">{busy ? "送信中…" : "ロス"}</span>
        <span className="snap__sub">廃棄・まかない</span>
      </button>
      <div className="snap__more">
        <button type="button" disabled={busy} onClick={() => lib.current?.click()} aria-label="ロスの写真を保存した写真から選ぶ">
          🖼 写真
        </button>
        <button type="button" aria-pressed={note} onClick={() => setNote(!note)} aria-label="ひとことを書く">
          💬 ひとこと
        </button>
      </div>
      {note ? (
        <input className="field" aria-label="ひとこと" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="例：まかない 唐揚げ2人前" />
      ) : null}
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden aria-label="ロスを撮る（カメラ）" onChange={(e) => onFiles(e.target.files)} />
      <input ref={lib} type="file" accept="image/*" multiple hidden aria-label="ロスの写真を選ぶ" onChange={(e) => onFiles(e.target.files)} />
      {msg ? <p className="snap__msg">✓ {msg}</p> : null}
      {err ? <p className="err">{err}</p> : null}
    </div>
  );
}
