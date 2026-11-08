"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAlertsPaused } from "./actions";

/** 温度計のLINEの知らせ（店長LINE）を止める／再開する。止めている間も温度の記録は続く */
export default function AlertSwitch({ paused, canManage }: { paused: boolean; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const toggle = () =>
    start(async () => {
      setErr(null);
      const r = await setAlertsPaused(!paused);
      if (!r.ok) setErr(r.error);
      else router.refresh();
    });
  return (
    <section className={`sb-alert${paused ? " sb-alert--paused" : ""}`} aria-label="LINEの知らせ">
      <span>
        LINEの知らせ：<strong>{paused ? "止めています" : "送ります"}</strong>
        <span className="micro">　{paused ? "温度の記録は続けています" : "基準外・読めない・電池切れ"}</span>
      </span>
      {canManage ? (
        <button type="button" className="btn btn-sm" disabled={pending} onClick={toggle}>
          {paused ? "再開する" : "止める"}
        </button>
      ) : null}
      {err ? <p className="err">{err}</p> : null}
    </section>
  );
}
