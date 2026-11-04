"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DISPOSITIONS, INCIDENT_CATEGORY_LABEL } from "@/lib/haccp";
import type { IncidentRow } from "@/lib/haccp-data";
import { fromLocalInput, mdhm, nowLocalInput, toLocalInput } from "@/lib/haccp-time";
import { saveIncident } from "../actions";

type P = {
  open: IncidentRow[];
  done: IncidentRow[];
  today: string;
  canManage: boolean;
  staff: { id: string; name: string }[];
  names: Record<string, string>;
  guides: Record<string, string>;
};

export default function IncidentList(p: P) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="wrap stack">
      <section className="notice">
        温度逸脱・加熱不足・冷却不良・害虫などの「起きたこと」と「やったこと」を残します。
        対応の判断は計画に書いた対応に沿って行い、提供を止める・廃棄する・責任者に確認する、も選べます。
        記録の完了と、問題への対応の完了は別に管理します（対応済みにするのは店長・オーナー）。
      </section>
      {adding ? <NewIncident {...p} onDone={() => setAdding(false)} /> : (
        <button type="button" className="btn btn-block" onClick={() => setAdding(true)}>＋ 異常を記録（害虫の発見など）</button>
      )}
      <h2 className="section-title">対応中（{p.open.length}）</h2>
      {p.open.length === 0 ? <p className="micro">対応中の異常はありません。</p> : null}
      {p.open.map((i) => <IncidentCard key={i.id} i={i} {...p} />)}
      <h2 className="section-title">対応済み（直近60日）</h2>
      {p.done.length === 0 ? <p className="micro">ありません。</p> : null}
      {p.done.map((i) => <IncidentCard key={i.id} i={i} {...p} />)}
    </div>
  );
}

function guideFor(i: IncidentRow, guides: Record<string, string>): string {
  if (!i.plan_id) return "";
  if (i.category === "temp") return guides[`${i.plan_id}:gen:fridge`] ?? "";
  if (i.category === "receiving") return guides[`${i.plan_id}:gen:receiving`] ?? "";
  if (i.category === "health") return guides[`${i.plan_id}:gen:health`] ?? "";
  if (i.category === "pest") return guides[`${i.plan_id}:gen:kitchen`] ?? "";
  if (i.category === "cooling") return guides[`${i.plan_id}:cc:g3`] ?? "";
  if (i.category === "heating") return guides[`${i.plan_id}:cc:g2`] ?? "";
  return "";
}

function IncidentCard({ i, ...p }: P & { i: IncidentRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    action: i.action ?? "",
    dispositions: i.dispositions,
    recheckAt: toLocalInput(i.recheck_at),
    recheckResult: (i.recheck_result ?? "") as "ok" | "ng" | "",
    recheckNote: i.recheck_note ?? "",
    handlerId: i.handler_id ?? "",
    dueOn: i.due_on ?? "",
    prevention: i.prevention ?? "",
  });
  const guide = guideFor(i, p.guides);
  const save = (status: "open" | "done") =>
    start(async () => {
      setErr(null);
      const r = await saveIncident({ id: i.id, ...f, recheckAt: fromLocalInput(f.recheckAt), status });
      if (!r.ok) setErr(r.error);
      else {
        setEdit(false);
        router.refresh();
      }
    });
  const overdue = i.status === "open" && i.due_on && i.due_on < p.today;
  return (
    <article className={`hc-card hc-card--${i.status === "open" ? "ng" : "ok"}`}>
      <header className="hc-card__head">
        <div className="hc-card__title">
          {i.target}
          <span className="hc-card__limit">{INCIDENT_CATEGORY_LABEL[i.category] ?? i.category}</span>
        </div>
        <span className={`hc-pill hc-pill--${i.status === "open" ? "ng" : "ok"}`}>{i.status === "open" ? "対応中" : "対応済み"}</span>
      </header>
      <div className="hc-rec">
        <div>発生：{mdhm(i.occurred_at)}（{i.biz_date}の営業）</div>
        <div>問題：{i.problem}</div>
        {i.action ? <div>対応：{i.action}</div> : null}
        {i.dispositions.length ? <div>処置：{i.dispositions.join("・")}</div> : null}
        {i.recheck_at || i.recheck_result ? (
          <div>再確認：{mdhm(i.recheck_at)} {i.recheck_result === "ok" ? "問題なし" : i.recheck_result === "ng" ? "まだ問題あり" : ""} {i.recheck_note ?? ""}</div>
        ) : null}
        {i.prevention ? <div>改善・再発防止：{i.prevention}</div> : null}
        <div className="micro">
          記録 {p.names[i.created_by] ?? "?"}　担当 {p.names[i.handler_id ?? ""] ?? "未定"}
          {i.due_on ? <span className={overdue ? "err" : ""}>　期限 {i.due_on}{overdue ? "（過ぎています）" : ""}</span> : null}
          {i.confirmer_id ? `　確認 ${p.names[i.confirmer_id] ?? "?"}（${mdhm(i.confirmed_at)}）` : ""}
          {i.entered_late ? <span className="hc-tag">追記</span> : null}
          {i.updated_at ? (
            <Link className="hc-tag" href={`/haccp/history?t=haccp_incidents&id=${i.id}`}>履歴</Link>
          ) : null}
        </div>
      </div>
      {guide ? <p className="hc-guide">計画での対応：{guide}</p> : null}
      {!edit ? (
        <button type="button" className="linklike" onClick={() => setEdit(true)}>
          {i.status === "open" ? "対応・再確認を入れる" : "内容を見直す"}
        </button>
      ) : (
        <div className="hc-ng stack">
          <span className="field-label">実施した対応</span>
          <textarea aria-label="実施した対応" className="field" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} />
          <span className="field-label">処置</span>
          <div className="chips">
            {DISPOSITIONS.map((d) => (
              <button key={d} type="button" className="chip" aria-pressed={f.dispositions.includes(d)}
                onClick={() => setF({ ...f, dispositions: f.dispositions.includes(d) ? f.dispositions.filter((x) => x !== d) : [...f.dispositions, d] })}>
                {d}
              </button>
            ))}
          </div>
          <span className="field-label">再確認の時刻</span>
          <div className="row">
            <input aria-label="再確認の時刻" className="field" type="datetime-local" value={f.recheckAt} onChange={(e) => setF({ ...f, recheckAt: e.target.value })} />
            <button type="button" className="btn btn-sm" onClick={() => setF({ ...f, recheckAt: nowLocalInput() })}>今</button>
          </div>
          <div className="seg">
            <button type="button" className="seg__btn" aria-pressed={f.recheckResult === "ok"} onClick={() => setF({ ...f, recheckResult: "ok" })}>再確認：問題なし</button>
            <button type="button" className="seg__btn" aria-pressed={f.recheckResult === "ng"} onClick={() => setF({ ...f, recheckResult: "ng" })}>まだ問題あり</button>
          </div>
          <input className="field" value={f.recheckNote} onChange={(e) => setF({ ...f, recheckNote: e.target.value })} placeholder="再確認の結果（例：庫内6℃）" />
          <span className="field-label">担当者</span>
          <select aria-label="担当者" className="field" value={f.handlerId} onChange={(e) => setF({ ...f, handlerId: e.target.value })}>
            <option value="">未定</option>
            {p.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <span className="field-label">対応期限</span>
          <input aria-label="対応期限" className="field" type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} />
          <span className="field-label">改善・再発防止</span>
          <textarea aria-label="改善・再発防止" className="field" value={f.prevention} onChange={(e) => setF({ ...f, prevention: e.target.value })} />
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button type="button" className="btn" disabled={pending} onClick={() => save(i.status === "done" ? "done" : "open")}>保存</button>
            {p.canManage && i.status === "open" ? (
              <button type="button" className="btn btn-primary" disabled={pending} onClick={() => save("done")}>対応済みにする（確認者として）</button>
            ) : null}
            {p.canManage && i.status === "done" ? (
              <button type="button" className="btn btn-danger" disabled={pending} onClick={() => save("open")}>対応中に戻す</button>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={() => setEdit(false)}>閉じる</button>
          </div>
        </div>
      )}
      {err ? <p className="err">{err}</p> : null}
    </article>
  );
}

function NewIncident(p: P & { onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ date: p.today, at: nowLocalInput(), category: "pest", target: "", problem: "", action: "", dispositions: [] as string[] });
  return (
    <section className="card stack">
      <span className="field-label">営業日</span>
      <input aria-label="営業日" className="field" type="date" max={p.today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
      <span className="field-label">発生日時</span>
      <input aria-label="発生日時" className="field" type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} />
      <span className="field-label">種類</span>
      <select aria-label="種類" className="field" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
        {Object.entries(INCIDENT_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <span className="field-label">対象（設備・料理・仕込み・場所）</span>
      <input aria-label="対象" className="field" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="例：厨房の排水口付近" />
      <span className="field-label">問題の内容</span>
      <textarea aria-label="問題の内容" className="field" value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} placeholder="例：ゴキブリを1匹見つけた" />
      <span className="field-label">その場で行った対応</span>
      <textarea aria-label="その場で行った対応" className="field" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} />
      <div className="chips">
        {DISPOSITIONS.map((d) => (
          <button key={d} type="button" className="chip" aria-pressed={f.dispositions.includes(d)}
            onClick={() => setF({ ...f, dispositions: f.dispositions.includes(d) ? f.dispositions.filter((x) => x !== d) : [...f.dispositions, d] })}>
            {d}
          </button>
        ))}
      </div>
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveIncident({
                date: f.date,
                occurredAt: fromLocalInput(f.at) ?? undefined,
                category: f.category,
                target: f.target,
                problem: f.problem,
                action: f.action,
                dispositions: f.dispositions,
              });
              if (!r.ok) setErr(r.error);
              else {
                p.onDone();
                router.refresh();
              }
            })
          }
        >
          記録する（対応中で始まります）
        </button>
        <button type="button" className="btn btn-ghost" onClick={p.onDone}>やめる</button>
      </div>
      {err ? <p className="err">{err}</p> : null}
    </section>
  );
}
