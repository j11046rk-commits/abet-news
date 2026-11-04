"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addNotice, createDraft } from "../actions";

export function CreateDraftButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await createDraft();
            if (!r.ok) setErr(r.error);
            else router.refresh();
          })
        }
      >
        {label}
      </button>
      {err ? <p className="err">{err}</p> : null}
    </>
  );
}

export function NoticeForm({ planId, today }: { planId: string; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [on, setOn] = useState(today);
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="stack hc-ng">
      <label>
        <span className="field-label">周知した日</span>
        <input className="field" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
      </label>
      <label>
        <span className="field-label">周知のしかた</span>
        <input className="field" value={method} onChange={(e) => setMethod(e.target.value)} placeholder="例：営業前に全員で読み合わせ／スタッフLINEで共有" />
      </label>
      <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="メモ（任意）" />
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await addNotice({ planId, noticedOn: on, method, note });
            if (!r.ok) setErr(r.error);
            else {
              setMethod("");
              setNote("");
              router.refresh();
            }
          })
        }
      >
        周知を記録
      </button>
      {err ? <p className="err">{err}</p> : null}
    </div>
  );
}
