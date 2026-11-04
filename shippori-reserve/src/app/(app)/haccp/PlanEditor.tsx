"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BASIS_LABEL,
  CANDIDATE_KIND_LABEL,
  EQUIPMENT_KIND_LABEL,
  GROUP_LABEL,
  LEGAL_DUTIES,
  MENU_EXAMPLES,
  STEP_LABEL,
  TIMINGS,
  TIMING_LABEL,
  VARIANTS,
  blankCriteria,
  candidatesFor,
  newMenu,
  planIssues,
  stepsFor,
  type Candidate,
  type CandidateTarget,
  type CcGroup,
  type Equipment,
  type EquipmentKind,
  type MenuPlan,
  type PlanContent,
  type StepKey,
  type Timing,
} from "@/lib/haccp";
import { approvePlan, discardDraft, saveDraft } from "./actions";

type Draft = {
  id: string;
  version: number;
  store_name: string | null;
  hygiene_manager: string | null;
  author_name: string | null;
  effective_from: string | null;
  change_reason: string | null;
  content: PlanContent;
};

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));

export default function PlanEditor({ draft, canApprove, hasApproved }: { draft: Draft; canApprove: boolean; hasApproved: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [h, setH] = useState({
    store_name: draft.store_name ?? "",
    hygiene_manager: draft.hygiene_manager ?? "",
    author_name: draft.author_name ?? "",
    effective_from: draft.effective_from ?? "",
    change_reason: draft.change_reason ?? "",
  });
  const [c, setC] = useState<PlanContent>(draft.content);
  const [dirty, setDirty] = useState(false);
  const upd = (f: (x: PlanContent) => PlanContent) => {
    setC((x) => f(structuredClone(x)));
    setDirty(true);
  };
  const issues = planIssues({ ...h, effective_from: h.effective_from || null }, c);
  if (draft.version > 1 && !h.change_reason.trim()) issues.push("変更理由（この版で何を変えたか）が未設定です");

  const save = (then?: () => Promise<void>) =>
    start(async () => {
      setMsg(null);
      const r = await saveDraft({ id: draft.id, ...h, effective_from: h.effective_from || null, content: c });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setDirty(false);
      if (then) await then();
      else {
        setMsg({ ok: true, text: "下書きを保存しました。" });
        router.refresh();
      }
    });

  const approve = () =>
    save(async () => {
      const r = await approvePlan(draft.id);
      if (!r.ok) setMsg({ ok: false, text: r.error });
      else {
        setMsg({ ok: true, text: "計画を確定しました。スタッフへの周知を記録してください。" });
        router.refresh();
      }
    });

  const timingChips = (val: Timing[], on: (v: Timing[]) => void, label: string) => (
    <div className="chips" role="group" aria-label={label}>
      {TIMINGS.map((t) => (
        <button
          key={t}
          type="button"
          className="chip"
          aria-pressed={val.includes(t)}
          onClick={() => on(val.includes(t) ? val.filter((x) => x !== t) : [...val, t])}
        >
          {TIMING_LABEL[t]}
        </button>
      ))}
    </div>
  );

  const groupsUsed = (["g1", "g2", "g3"] as CcGroup[]).filter((g) => c.menus.some((m) => m.group === g));

  return (
    <div className="stack hc-plan">
      <section className="notice notice-strong">
        <strong>下書き（第{draft.version}版）</strong>。下書きのあいだは毎日のチェックに使われません。
        責任者（オーナー）が店の実態と照らし合わせて確定すると、適用開始日から使われます。
        候補の数値は、出典を確かめてから「使う」を押したときだけ入ります。
      </section>

      <section className="card stack">
        <h2 className="section-title" style={{ margin: 0 }}>店舗・責任者</h2>
        <Field label="店舗名" value={h.store_name} on={(v) => { setH({ ...h, store_name: v }); setDirty(true); }} />
        <Field label="食品衛生責任者" value={h.hygiene_manager} on={(v) => { setH({ ...h, hygiene_manager: v }); setDirty(true); }} placeholder="食品衛生責任者の氏名" />
        <Field label="計画作成者" value={h.author_name} on={(v) => { setH({ ...h, author_name: v }); setDirty(true); }} />
        <label>
          <span className="field-label">適用開始日</span>
          <input className="field" type="date" value={h.effective_from} onChange={(e) => { setH({ ...h, effective_from: e.target.value }); setDirty(true); }} />
        </label>
        {draft.version > 1 || hasApproved ? (
          <Field label="変更理由（この版で何を変えたか・メニューや設備の変更など）" value={h.change_reason} on={(v) => { setH({ ...h, change_reason: v }); setDirty(true); }} area />
        ) : null}
        <p className="micro">承認者は、確定ボタンを押したオーナーのアカウントが自動で入ります。</p>
      </section>

      <section className="card stack">
        <h2 className="section-title" style={{ margin: 0 }}>法令で求められていること</h2>
        <ul className="pv-list">
          {LEGAL_DUTIES.map((d) => (
            <li key={d.text}>{d.text}<span className="pv-src">（{d.source}）</span></li>
          ))}
        </ul>
        <p className="micro">下の各項目の確認方法は、手引書の記載例をもとにした「たたき台」です。店のやり方に合わせて書き換えてください。</p>
      </section>

      <h2 className="section-title">一般衛生管理</h2>
      {c.general.map((g, i) => (
        <section key={g.key} className={`card stack${g.enabled ? "" : " hc-off"}`}>
          <label className="hc-toggle">
            <input type="checkbox" checked={g.enabled} onChange={(e) => upd((x) => { x.general[i].enabled = e.target.checked; return x; })} />
            <strong>{g.no} {g.label}</strong>
          </label>
          <span className="pv-src">{BASIS_LABEL[g.basis]}</span>
          {g.enabled ? (
            <>
              {g.key === "fridge" ? (
                <p className="micro">いつ測るかは、下の「冷蔵庫・冷凍庫」で設備ごとに決めます。</p>
              ) : (
                <>
                  <span className="field-label">いつ</span>
                  {timingChips(g.timings, (v) => upd((x) => { x.general[i].timings = v; return x; }), `${g.label}のタイミング`)}
                </>
              )}
              <Field label="誰が（任意）" value={g.who} on={(v) => upd((x) => { x.general[i].who = v; return x; })} placeholder="例：店長／その日の調理担当" />
              <Field label="どのように確認するか" value={g.how} on={(v) => upd((x) => { x.general[i].how = v; return x; })} area />
              <Field label="問題があったときの対応" value={g.onProblem} on={(v) => upd((x) => { x.general[i].onProblem = v; return x; })} area />
              {g.key !== "fridge" ? (
                <label className="hc-toggle">
                  <input type="checkbox" checked={g.allowNA} onChange={(e) => upd((x) => { x.general[i].allowNA = e.target.checked; return x; })} />
                  「該当なし」を選べる（例：納品が無い日）
                </label>
              ) : null}
            </>
          ) : null}
        </section>
      ))}

      <h2 className="section-title">冷蔵庫・冷凍庫</h2>
      <p className="micro">店にある台数だけ登録してください（例は入れていません）。</p>
      {c.equipment.map((e, i) => (
        <EquipmentCard
          key={e.id}
          e={e}
          timingChips={timingChips}
          on={(f) => upd((x) => { x.equipment[i] = f(x.equipment[i]); return x; })}
          remove={() => upd((x) => { x.equipment.splice(i, 1); return x; })}
        />
      ))}
      <button
        type="button"
        className="btn btn-block"
        onClick={() => upd((x) => { x.equipment.push({ id: uid(), name: "", kind: "fridge", maxC: null, minC: null, timings: ["close"], basis: "" }); return x; })}
      >
        ＋ 設備を追加
      </button>

      <h2 className="section-title">重要管理（メニュー別）</h2>
      <section className="notice">
        分類は料理名ではなく、実際の調理工程で決めます。例（登録はされません）：
        <ul className="pv-list">
          {MENU_EXAMPLES.map((m) => (
            <li key={m.group}>{GROUP_LABEL[m.group]}：{m.text}</li>
          ))}
        </ul>
        作り置きのおばんざいを室温で並べておく運用は、初期設定にしていません。
      </section>
      {c.menus.map((m, i) => (
        <MenuCard
          key={m.id}
          m={m}
          on={(f) => upd((x) => { x.menus[i] = f(x.menus[i]); return x; })}
          remove={() => upd((x) => { x.menus.splice(i, 1); return x; })}
        />
      ))}
      <button type="button" className="btn btn-block" onClick={() => upd((x) => { x.menus.push(newMenu(uid())); return x; })}>
        ＋ メニュー（料理・仕込み）を追加
      </button>

      {groupsUsed.length > 0 ? <h2 className="section-title">グループごとの日々の確認</h2> : null}
      {groupsUsed.map((g) => (
        <section key={g} className="card stack">
          <strong>{GROUP_LABEL[g]}</strong>
          {timingChips(c.cc[g].timings, (v) => upd((x) => { x.cc[g].timings = v; return x; }), `${GROUP_LABEL[g]}のタイミング`)}
          <Field label="誰が（任意）" value={c.cc[g].who} on={(v) => upd((x) => { x.cc[g].who = v; return x; })} />
          <Field label="どのように確認するか" value={c.cc[g].how} on={(v) => upd((x) => { x.cc[g].how = v; return x; })} area />
          <Field label="問題があったときの対応（任意）" value={c.cc[g].onProblem} on={(v) => upd((x) => { x.cc[g].onProblem = v; return x; })} area placeholder="例：提供を止め、責任者に確認する" />
        </section>
      ))}

      <section className={`card stack ${issues.length ? "hc-issues" : "hc-ready"}`} aria-live="polite">
        <h2 className="section-title" style={{ margin: 0 }}>
          {issues.length ? `運用準備：未完了（未設定 ${issues.length}件）` : "未設定の項目はありません（確定できます）"}
        </h2>
        {issues.length ? (
          <ul className="pv-list">
            {issues.slice(0, 40).map((s) => <li key={s}>{s}</li>)}
          </ul>
        ) : null}
      </section>

      <div className="hc-savebar">
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => save()}>
          {dirty ? "下書きを保存" : "保存済み"}
        </button>
        {canApprove ? (
          <button type="button" className="btn" disabled={pending || issues.length > 0} onClick={approve}>
            確定（承認）する
          </button>
        ) : (
          <span className="micro">確定はオーナーが行います</span>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={pending}
          onClick={() => {
            if (!confirm("この下書きを捨てますか？（承認済みの計画には影響しません）")) return;
            start(async () => {
              const r = await discardDraft(draft.id);
              if (!r.ok) setMsg({ ok: false, text: r.error });
              else router.refresh();
            });
          }}
        >
          下書きを捨てる
        </button>
      </div>
      {msg ? <p className={msg.ok ? "notice" : "err"}>{msg.text}</p> : null}
    </div>
  );
}

function Field({ label, value, on, area, placeholder }: { label: string; value: string; on: (v: string) => void; area?: boolean; placeholder?: string }) {
  return (
    <label>
      <span className="field-label">{label}</span>
      {area ? (
        <textarea className="field" value={value} placeholder={placeholder} onChange={(e) => on(e.target.value)} />
      ) : (
        <input className="field" value={value} placeholder={placeholder} onChange={(e) => on(e.target.value)} />
      )}
    </label>
  );
}

function NumField({ label, value, on }: { label: string; value: number | null; on: (v: number | null) => void }) {
  return (
    <label>
      <span className="field-label">{label}</span>
      <input
        className="field"
        inputMode="decimal"
        value={value ?? ""}
        onChange={(e) => {
          const s = e.target.value.replace("−", "-");
          on(s.trim() === "" || s === "-" ? null : Number.isFinite(Number(s)) ? Number(s) : value);
        }}
      />
    </label>
  );
}

function Candidates({ target, onUse }: { target: CandidateTarget; onUse: (c: Candidate) => void }) {
  const list = candidatesFor(target);
  if (list.length === 0) return null;
  return (
    <details className="hc-cand">
      <summary>設定候補（出典つき）</summary>
      {list.map((c) => (
        <div key={c.id} className="hc-cand__item">
          <div>
            <strong>{c.label}</strong>
            <span className="hc-tag">{CANDIDATE_KIND_LABEL[c.kind]}</span>
          </div>
          <div className="pv-src">出典：{c.source}</div>
          {c.caution ? <div className="pv-src">注意：{c.caution}</div> : null}
          {Object.keys(c.apply).length ? (
            <button type="button" className="btn btn-sm" onClick={() => onUse(c)}>
              この候補を使う
            </button>
          ) : null}
        </div>
      ))}
    </details>
  );
}

function EquipmentCard({
  e,
  on,
  remove,
  timingChips,
}: {
  e: Equipment;
  on: (f: (e: Equipment) => Equipment) => void;
  remove: () => void;
  timingChips: (val: Timing[], on: (v: Timing[]) => void, label: string) => React.ReactNode;
}) {
  return (
    <section className="card stack">
      <Field label="設備名" value={e.name} on={(v) => on((x) => ({ ...x, name: v }))} placeholder="例：厨房の冷蔵庫（左）" />
      <label>
        <span className="field-label">種類</span>
        <select className="field" value={e.kind} onChange={(ev) => on((x) => ({ ...x, kind: ev.target.value as EquipmentKind }))}>
          {(Object.keys(EQUIPMENT_KIND_LABEL) as EquipmentKind[]).map((k) => (
            <option key={k} value={k}>{EQUIPMENT_KIND_LABEL[k]}</option>
          ))}
        </select>
      </label>
      <div className="hc-grid2">
        <NumField label="上限（℃以下）" value={e.maxC} on={(v) => on((x) => ({ ...x, maxC: v }))} />
        <NumField label="下限（℃以上・必要なら）" value={e.minC} on={(v) => on((x) => ({ ...x, minC: v }))} />
      </div>
      <Candidates
        target={e.kind === "freezer" ? "freezer" : "fridge"}
        onUse={(c) => on((x) => ({ ...x, maxC: c.apply.maxC ?? x.maxC, basis: `${c.label}（${c.source}）` }))}
      />
      <Field label="基準の根拠" value={e.basis} on={(v) => on((x) => ({ ...x, basis: v }))} />
      <label className="hc-toggle">
        <input type="checkbox" checked={!!e.auto} onChange={(ev) => on((x) => ({ ...x, auto: ev.target.checked }))} />
        温度は温度計（SwitchBot）で自動記録する（毎日の入力に出さない）
      </label>
      {!e.auto ? (
        <>
          <span className="field-label">測るとき</span>
          {timingChips(e.timings, (v) => on((x) => ({ ...x, timings: v })), `${e.name}を測るとき`)}
        </>
      ) : null}
      <button type="button" className="btn btn-danger btn-sm" onClick={remove}>この設備を外す</button>
    </section>
  );
}

function MenuCard({ m, on, remove }: { m: MenuPlan; on: (f: (m: MenuPlan) => MenuPlan) => void; remove: () => void }) {
  const steps = stepsFor(m.group, m.variant);
  const setCrit = (f: (c: MenuPlan["criteria"]) => MenuPlan["criteria"]) => on((x) => ({ ...x, criteria: f(structuredClone(x.criteria)) }));
  const heatLike = (s: "heat" | "reheat") => {
    const c = m.criteria[s]!;
    return (
      <fieldset key={s} className="hc-step">
        <legend>{STEP_LABEL[s]}</legend>
        <div className="seg">
          <button type="button" className="seg__btn" aria-pressed={c.mode === "measure"} onClick={() => setCrit((x) => { x[s]!.mode = "measure"; return x; })}>中心温度で確認</button>
          <button type="button" className="seg__btn" aria-pressed={c.mode === "visual"} onClick={() => setCrit((x) => { x[s]!.mode = "visual"; return x; })}>見た目などで確認</button>
        </div>
        {c.mode === "measure" ? (
          <div className="hc-grid2">
            <NumField label="中心温度（℃以上）" value={c.minC} on={(v) => setCrit((x) => { x[s]!.minC = v; return x; })} />
            <NumField label="保持時間（秒以上）" value={c.holdSec} on={(v) => setCrit((x) => { x[s]!.holdSec = v; return x; })} />
          </div>
        ) : (
          <Field label="確認する見た目・状態" value={c.visual} on={(v) => setCrit((x) => { x[s]!.visual = v; return x; })} placeholder="例：中心部の肉汁が透明・断面に赤みがない" />
        )}
        {!m.special.lowTemp ? (
          <Candidates
            target={s === "reheat" ? "reheat" : m.special.bivalve ? "heat_bivalve" : "heat"}
            onUse={(cd) => setCrit((x) => { x[s] = { mode: "measure", minC: cd.apply.minC ?? null, holdSec: cd.apply.holdSec ?? null, visual: "" }; return x; })}
          />
        ) : (
          <p className="micro">低温調理は、一般的な加熱条件を一律に当てはめません。検証した条件を入れてください。</p>
        )}
      </fieldset>
    );
  };

  return (
    <section className="card stack">
      <Field label="料理名（実際に出しているもの）" value={m.name} on={(v) => on((x) => ({ ...x, name: v }))} />
      <label>
        <span className="field-label">調理工程のグループ</span>
        <select
          className="field"
          value={m.group}
          onChange={(e) => {
            const g = e.target.value as CcGroup | "";
            const v = g ? VARIANTS[g][0].value : "";
            on((x) => ({ ...x, group: g, variant: v, criteria: blankCriteria(stepsFor(g, v), x.criteria) }));
          }}
        >
          <option value="">選んでください</option>
          {(["g1", "g2", "g3"] as CcGroup[]).map((g) => (
            <option key={g} value={g}>{GROUP_LABEL[g]}</option>
          ))}
        </select>
      </label>
      {m.group ? (
        <label>
          <span className="field-label">提供のしかた</span>
          <select
            className="field"
            value={m.variant}
            onChange={(e) => on((x) => ({ ...x, variant: e.target.value, criteria: blankCriteria(stepsFor(x.group, e.target.value), x.criteria) }))}
          >
            {VARIANTS[m.group].map((v) => (
              <option key={v.value} value={v.value}>{v.label}（{v.steps.map((s) => STEP_LABEL[s]).join("→")}）</option>
            ))}
          </select>
        </label>
      ) : null}
      <Field label="確認方法" value={m.method} on={(v) => on((x) => ({ ...x, method: v }))} placeholder="例：火の通りを色と肉汁で確認／冷ましてから冷蔵庫へ" area />
      <label className="hc-toggle">
        <input type="checkbox" checked={m.batchRecord} onChange={(e) => on((x) => ({ ...x, batchRecord: e.target.checked }))} />
        仕込みごとに温度を記録する（任意。付けない料理は1日1回の○×だけ）
      </label>
      <div className="chips">
        <label className="hc-toggle"><input type="checkbox" checked={m.special.rawSeafood} onChange={(e) => on((x) => ({ ...x, special: { ...x.special, rawSeafood: e.target.checked } }))} />生食用の魚介類</label>
        <label className="hc-toggle"><input type="checkbox" checked={m.special.bivalve} onChange={(e) => on((x) => ({ ...x, special: { ...x.special, bivalve: e.target.checked } }))} />二枚貝など</label>
        <label className="hc-toggle"><input type="checkbox" checked={m.special.lowTemp} onChange={(e) => on((x) => ({ ...x, special: { ...x.special, lowTemp: e.target.checked } }))} />低温調理</label>
      </div>
      {m.special.rawSeafood ? (
        <>
          <Field label="生食用魚介類の管理方法（アニサキス対策など）" value={m.special.rawControl} on={(v) => on((x) => ({ ...x, special: { ...x.special, rawControl: v } }))} area />
          <Candidates target="anisakis" onUse={() => undefined} />
        </>
      ) : null}
      {m.special.lowTemp ? (
        <Field label="低温調理の条件の根拠（検証した条件・参照した資料）" value={m.special.lowTempBasis} on={(v) => on((x) => ({ ...x, special: { ...x.special, lowTempBasis: v } }))} area />
      ) : null}
      {m.batchRecord ? (
        <>
          {steps.map((s: StepKey) => {
        if (s === "heat" || s === "reheat") return heatLike(s);
        if (s === "cool")
          return (
            <fieldset key={s} className="hc-step">
              <legend>冷却</legend>
              <div className="hc-grid2">
                <NumField label="何分以内に" value={m.criteria.cool?.withinMin ?? null} on={(v) => setCrit((x) => { x.cool = { targetC: x.cool?.targetC ?? null, withinMin: v }; return x; })} />
                <NumField label="何℃以下まで" value={m.criteria.cool?.targetC ?? null} on={(v) => setCrit((x) => { x.cool = { withinMin: x.cool?.withinMin ?? null, targetC: v }; return x; })} />
              </div>
              <Candidates target="cool" onUse={(cd) => setCrit((x) => { x.cool = { targetC: cd.apply.targetC ?? null, withinMin: cd.apply.withinMin ?? null }; return x; })} />
            </fieldset>
          );
        if (s === "chill")
          return (
            <fieldset key={s} className="hc-step">
              <legend>冷蔵保管</legend>
              <NumField label="何℃以下で保管" value={m.criteria.chill?.maxC ?? null} on={(v) => setCrit((x) => { x.chill = { maxC: v }; return x; })} />
              <Candidates target={m.special.rawSeafood ? "raw_fish_chill" : "fridge"} onUse={(cd) => setCrit((x) => { x.chill = { maxC: cd.apply.maxC ?? null }; return x; })} />
            </fieldset>
          );
        return (
          <fieldset key={s} className="hc-step">
            <legend>高温保管</legend>
            <NumField label="何℃以上で保管" value={m.criteria.hotHold?.minC ?? null} on={(v) => setCrit((x) => { x.hotHold = { minC: v }; return x; })} />
            <Candidates target="hot_hold" onUse={(cd) => setCrit((x) => { x.hotHold = { minC: cd.apply.minC ?? null }; return x; })} />
          </fieldset>
        );
      })}
        </>
      ) : null}
      {m.batchRecord && m.group === "g3" ? (
        <Field label="店舗で決めた使用期限（候補は出しません。店で決めてください）" value={m.useByRule} on={(v) => on((x) => ({ ...x, useByRule: v }))} />
      ) : null}
      <details className="hc-cand">
        <summary>詳しく書く（任意：危害要因・頻度・保存方法・外れたときの対応）</summary>
        <div className="stack" style={{ marginTop: "0.5rem" }}>
          <Field label="主な危害要因" value={m.hazards} on={(v) => on((x) => ({ ...x, hazards: v }))} placeholder="例：ウェルシュ菌（加熱後の冷却が遅いと増える）" area />
          <Field label="確認頻度" value={m.frequency} on={(v) => on((x) => ({ ...x, frequency: v }))} placeholder="例：毎日" />
          <Field label="保存方法" value={m.storage} on={(v) => on((x) => ({ ...x, storage: v }))} placeholder="例：浅い容器に小分けし、ふたをして冷蔵庫へ" />
          {!m.batchRecord && m.group === "g3" ? (
            <Field label="店舗で決めた使用期限" value={m.useByRule} on={(v) => on((x) => ({ ...x, useByRule: v }))} />
          ) : null}
          <Field label="基準を満たさなかった場合の対応" value={m.onFail} on={(v) => on((x) => ({ ...x, onFail: v }))} placeholder="例：提供しない。廃棄するか、責任者が判断する" area />
        </div>
      </details>
      <button type="button" className="btn btn-danger btn-sm" onClick={remove}>このメニューを外す</button>
    </section>
  );
}
