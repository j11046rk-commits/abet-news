"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveLaborCost } from "./actions";

type Row = { ym: string; total: number | null; ratio: string };

/**
 * 月の人件費の合計（オーナーが入れる）。店全体の1つの数字だけで、誰にいくらかは入れない。
 * 入っている月は実際の人件費率、空欄の月は推定（直近の実績の時間単価×労働時間）。
 */
export default function LaborCostForm({ rows, canEdit }: { rows: Row[]; canEdit: boolean }) {
  return (
    <section className="card stack" aria-label="人件費の合計">
      <h2 className="section-title">人件費（月の合計）</h2>
      <ul className="cost-list">
        {rows.map((r) => (
          <LaborRow key={r.ym} r={r} canEdit={canEdit} />
        ))}
      </ul>
      <p className="micro">
        店全体の合計だけを入れます（社員・アルバイトの給与、会社負担の社会保険料、外注費などの合計。オーナーの役員報酬は入れない）。
        個人ごとの額はアプリのどこにも入れません。店舗評価には「率」だけが出ます。空欄の月は推定です。
      </p>
    </section>
  );
}

function LaborRow({ r, canEdit }: { r: Row; canEdit: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(r.total != null ? String(r.total) : "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const save = () =>
    start(async () => {
      const t = v.normalize("NFKC").replace(/[,¥円\s]/g, "");
      const res = await saveLaborCost(r.ym, t === "" ? null : Number(t));
      setMsg(res.ok ? "✓" : res.error);
      if (res.ok) router.refresh();
    });
  return (
    <li className="cost-row">
      <div className="cost-row__main">
        <span className="cost-row__date">{Number(r.ym.slice(5))}月</span>
        <span className="cost-row__vendor micro">人件費率 {r.ratio}</span>
      </div>
      {canEdit ? (
        <div className="row">
          <input
            className="field"
            inputMode="numeric"
            aria-label={`${Number(r.ym.slice(5))}月の人件費の合計（円）`}
            placeholder="未入力（推定）"
            value={v}
            onChange={(e) => setV(e.target.value)}
          />
          <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={save}>
            保存
          </button>
          <span className="micro">{msg}</span>
        </div>
      ) : (
        <div className="micro">{r.total != null ? `${r.total.toLocaleString("ja-JP")}円` : "未入力（推定）"}</div>
      )}
    </li>
  );
}
