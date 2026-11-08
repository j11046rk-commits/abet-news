"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EvalTargets } from "@/lib/store-eval";
import { saveEvalTargets } from "./actions";

/** 店舗評価の目標（オーナーが変える。店長は見るだけ） */
export default function EvalTargetsForm({ targets, canEdit }: { targets: EvalTargets; canEdit: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ labor: String(targets.laborRatio), hour: String(targets.hourCost), cost: targets.costRatio != null ? String(targets.costRatio) : "" });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const n = (s: string) => Number(s.normalize("NFKC").replace(/[,%円\s]/g, ""));
  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await saveEvalTargets({ laborRatio: n(f.labor), hourCost: n(f.hour), costRatio: f.cost.trim() === "" ? null : n(f.cost) });
      setMsg(r.ok ? "保存しました。" : r.error);
      if (r.ok) router.refresh();
    });
  return (
    <section className="card stack" aria-label="評価の目標">
      <h2 className="section-title">目標</h2>
      <label className="field-label" htmlFor="ev-cost">原価率の目標（%）</label>
      <input id="ev-cost" className="field" inputMode="decimal" disabled={!canEdit} value={f.cost} placeholder="未設定" onChange={(e) => setF({ ...f, cost: e.target.value })} />
      <label className="field-label" htmlFor="ev-labor">人件費率の目標（%）</label>
      <input id="ev-labor" className="field" inputMode="decimal" disabled={!canEdit} value={f.labor} onChange={(e) => setF({ ...f, labor: e.target.value })} />
      <label className="field-label" htmlFor="ev-hour">1時間あたりの人件費の目安（円・実績の月が無いときだけ使う）</label>
      <input id="ev-hour" className="field" inputMode="numeric" disabled={!canEdit} value={f.hour} onChange={(e) => setF({ ...f, hour: e.target.value })} />
      <p className="micro">
        人件費率＝月の人件費の合計 ÷ 税抜売上。合計をまだ入れていない月は「直近の実績の月の1時間あたりの人件費 × 労働時間」で推定し、
        実績の月が1つも無いときだけ上の目安を使います。売上の目標は、売上タブの日ごと・月の目標をそのまま使います。
      </p>
      {canEdit ? (
        <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
          保存
        </button>
      ) : (
        <p className="micro">目標を変えられるのはオーナーだけです。</p>
      )}
      {msg ? <p className="micro">{msg}</p> : null}
    </section>
  );
}
