"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  GROUP_SHORT,
  RESULT_LABEL,
  STEP_LABEL,
  TIMING_LABEL,
  TIMINGS,
  judgeBatch,
  requiredChecks,
  stepsFor,
  type CheckResult,
  type PlanContent,
  type RequiredCheck,
  type StepKey,
  type StepValues,
} from "@/lib/haccp";
import type { BatchRow, CheckRow, DayCloseRow } from "@/lib/haccp-data";
import { closeDay, editCheck, saveBatch, saveCheck } from "./actions";
import { fromLocalInput, hm, mdhm, nowLocalInput, toLocalInput } from "@/lib/haccp-time";


type Props = {
  date: string;
  today: string;
  isClosed: boolean;
  plan: { id: string; version: number; content: PlanContent } | null;
  checks: CheckRow[];
  batches: BatchRow[];
  dayClose: DayCloseRow | null;
  names: Record<string, string>;
  meId: string;
  canManage: boolean;
  /** 温度計で自動記録する設備の、その日の値（0068）。設備ID → 最新の値と回数 */
  autoReadings?: Record<string, { temp_c: number; read_at: string; count: number; min: number; max: number }>;
};

export default function HaccpDay(p: Props) {
  const late = p.date < p.today;
  const [onlyTodo, setOnlyTodo] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [lateAt, setLateAt] = useState("");
  const req = useMemo(() => (p.plan ? requiredChecks(p.plan.content) : []), [p.plan]);
  const byKey = useMemo(() => new Map(p.checks.map((c) => [c.check_key, c])), [p.checks]);
  const filled = req.filter((r) => byKey.has(r.key)).length;

  if (!p.plan) {
    return (
      <div className="wrap stack">
        <section className="notice notice-strong">
          この日に使える<strong>承認済みの衛生管理計画がありません</strong>。
          計画を作り、責任者（オーナー）が確定すると、ここに毎日のチェックが出ます。
        </section>
        <Link className="btn btn-primary btn-block" href="/haccp/plan">衛生管理計画を開く</Link>
      </div>
    );
  }

  const hiddenByClosed = p.isClosed && !showClosed && p.checks.length === 0;

  return (
    <div className="wrap stack hc">
      <section className="hc-progress" aria-label="今日の進み具合">
        <div>
          <div className="hc-progress__num">
            {filled}<span>/{req.length}</span>
          </div>
          <div className="micro">記録済み（第{p.plan.version}版の計画）</div>
        </div>
        <div className="hc-progress__todo">
          {p.isClosed ? (
            <span className="hc-pill hc-pill--closed">休業日</span>
          ) : req.length - filled > 0 ? (
            <span className="hc-pill hc-pill--todo">未入力 {req.length - filled}</span>
          ) : (
            <span className="hc-pill hc-pill--ok">すべて記録済み</span>
          )}
          {p.dayClose ? <span className="hc-pill">締め済み</span> : null}
        </div>
        <label className="hc-toggle">
          <input type="checkbox" checked={onlyTodo} onChange={(e) => setOnlyTodo(e.target.checked)} />
          未入力だけ表示
        </label>
      </section>

      <AutoTemps {...p} late={late} lateAt={lateAt} />

      {late ? (
        <section className="notice notice-strong">
          <strong>過去の日の追記です。</strong>実施した日時を入れてから記録してください。
          入力した日時は別に自動で残り、「追記」と表示されます。
          <label className="field-label" style={{ marginTop: "0.6rem" }}>
            実施した日時<span className="req">必須</span>
          </label>
          <input
            className="field"
            type="datetime-local"
            value={lateAt}
            onChange={(e) => setLateAt(e.target.value)}
            aria-label="実施した日時"
          />
        </section>
      ) : null}

      {p.isClosed ? (
        <section className="notice">
          この日は<strong>休業日</strong>です。記録は要りません（「未記録」にはなりません）。
          {p.checks.length === 0 ? (
            <button type="button" className="linklike" style={{ marginLeft: "0.4rem" }} onClick={() => setShowClosed((v) => !v)}>
              {showClosed ? "閉じる" : "それでも記録する"}
            </button>
          ) : null}
        </section>
      ) : null}

      {hiddenByClosed
        ? null
        : TIMINGS.map((tm) => {
            const items = req.filter((r) => r.timing === tm && (!onlyTodo || !byKey.has(r.key)));
            if (items.length === 0) return null;
            const left = req.filter((r) => r.timing === tm && !byKey.has(r.key)).length;
            return (
              <section key={tm} className="stack" aria-label={TIMING_LABEL[tm]}>
                <h2 className="section-title">
                  {TIMING_LABEL[tm]}
                  {left > 0 ? <span className="hc-left">あと{left}</span> : <span className="hc-done">✓</span>}
                </h2>
                {items.map((r) => (
                  <CheckCard
                    key={r.key}
                    r={r}
                    row={byKey.get(r.key) ?? null}
                    plan={p.plan!}
                    date={p.date}
                    late={late}
                    lateAt={lateAt}
                    names={p.names}
                    canEdit={(row) => p.canManage || row.recorded_by === p.meId}
                  />
                ))}
              </section>
            );
          })}

      <Batches {...p} late={late} lateAt={lateAt} />

      <DayClose {...p} missing={req.length - filled} />
    </div>
  );
}

// ── 温度計で自動記録する冷蔵庫・冷凍庫（0068）──────────────────────
// 記録は毎晩1時ごろに自動で入る。入っていない日（温度計が止まっていた等）だけ、ここから手で記録できる。

function AutoTemps(p: Props & { late: boolean; lateAt: string }) {
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const plan = p.plan!;
  // 冷蔵庫①②③ → 冷凍庫①②③ の順（温度計タブと同じ・店主指定 2026-11-08）
  const kindOrder = (k: string) => (k === "fridge" ? 0 : k === "freezer" ? 1 : 2);
  const autoEq = plan.content.equipment
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.auto)
    .sort((a, b) => kindOrder(a.e.kind) - kindOrder(b.e.kind) || a.i - b.i)
    .map(({ e }) => e);
  const all = requiredChecks(plan.content, true);
  const byKey = new Map(p.checks.map((c) => [c.check_key, c]));
  // 今日のチェックには温度計の値を出さない（温度計タブで見る・店主指定 2026-11-08）。
  // 出すのは、過ぎた日で自動の記録が入らなかった設備だけ（温度計が止まっていた日の手入力の受け皿）
  const missingEq = p.date < p.today ? autoEq.filter((e) => !byKey.has(`eq:${e.id}:close`)) : [];
  if (missingEq.length === 0) return null;
  return (
    <section className="stack" aria-label="冷蔵庫・冷凍庫（温度計）">
      <h2 className="section-title">温度計の記録が入らなかった冷蔵庫・冷凍庫</h2>
      <p className="micro">この日は温度計の値が届かず、自動で記録できませんでした。測った温度があれば、ここから手で記録してください。</p>
      <ul className="hc-auto">
        {missingEq.map((e) => {
          const key = `eq:${e.id}:close`;
          const row = byKey.get(key) ?? null;
          const rd = p.autoReadings?.[e.id];
          const r = all.find((x) => x.key === key);
          const limit = [e.maxC != null ? `${e.maxC}℃以下` : "", e.minC != null ? `${e.minC}℃以上` : ""].filter(Boolean).join("・");
          const out = rd ? (e.maxC != null && rd.temp_c > e.maxC) || (e.minC != null && rd.temp_c < e.minC) : false;
          if (row || manual[e.id]) {
            return r ? (
              <li key={e.id}>
                <CheckCard
                  r={r}
                  row={row}
                  plan={plan}
                  date={p.date}
                  late={p.late}
                  lateAt={p.lateAt}
                  names={p.names}
                  canEdit={(x) => p.canManage || x.recorded_by === p.meId}
                />
              </li>
            ) : null;
          }
          return (
            <li key={e.id} className={`hc-auto__row${out ? " hc-auto__row--ng" : ""}`}>
              <div className="hc-auto__name">
                {e.name}
                <span className="hc-card__limit">基準 {limit}</span>
              </div>
              <div className="hc-auto__val">
                {rd ? (
                  <>
                    <strong>{rd.temp_c}℃</strong>
                    <span className="micro">
                      {" "}
                      {hm(rd.read_at)}時点・今日{rd.count}回（{rd.min}〜{rd.max}℃）
                    </span>
                  </>
                ) : (
                  <span className="micro">まだ値が届いていません</span>
                )}
              </div>
              <div className="micro">
                {p.date < p.today ? "自動の記録がありません。" : "今夜、自動で記録します。"}
                <button type="button" className="linklike" onClick={() => setManual({ ...manual, [e.id]: true })}>
                  手で記録する
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── 1項目のカード ─────────────────────────────────────────

function CheckCard({
  r,
  row,
  plan,
  date,
  late,
  lateAt,
  names,
  canEdit,
}: {
  r: RequiredCheck;
  row: CheckRow | null;
  plan: { content: PlanContent };
  date: string;
  late: boolean;
  lateAt: string;
  names: Record<string, string>;
  canEdit: (row: CheckRow) => boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"" | "ng" | "edit">("");
  const [temp, setTemp] = useState("");
  const [note, setNote] = useState("");
  const [action, setAction] = useState("");
  const [makeIncident, setMakeIncident] = useState(true);
  const [reason, setReason] = useState("");
  const [editResult, setEditResult] = useState<CheckResult>("ok");

  const g = r.kind === "gen" ? plan.content.general.find((x) => x.key === r.ref) : null;
  const eq = r.kind === "eq" ? plan.content.equipment.find((x) => x.id === r.ref) : null;
  const cc = r.kind === "cc" ? plan.content.cc[r.ref as "g1" | "g2" | "g3"] : null;
  const fridge = plan.content.general.find((x) => x.key === "fridge");
  const how = g?.how ?? (eq ? fridge?.how : cc?.how) ?? "";
  const who = g?.who ?? (eq ? fridge?.who : cc?.who) ?? "";
  const onProblem = g?.onProblem ?? (eq ? fridge?.onProblem : cc?.onProblem) ?? "";
  const limit = eq
    ? [eq.maxC != null ? `${eq.maxC}℃以下` : "", eq.minC != null ? `${eq.minC}℃以上` : ""].filter(Boolean).join("・")
    : "";
  const tempNum = temp.trim() === "" ? null : Number(temp);
  const tempBad =
    eq && tempNum != null && Number.isFinite(tempNum)
      ? (eq.maxC != null && tempNum > eq.maxC) || (eq.minC != null && tempNum < eq.minC)
      : false;

  const save = (result: CheckResult) => {
    setErr(null);
    if (late && !lateAt) {
      setErr("先に上の「実施した日時」を入れてください。");
      return;
    }
    start(async () => {
      const res = await saveCheck({
        date,
        key: r.key,
        result,
        tempC: eq ? temp : null,
        measuredAt: late ? fromLocalInput(lateAt) : null,
        note,
        action,
        makeIncident,
      });
      if (!res.ok) setErr(res.error);
      else {
        setMode("");
        router.refresh();
      }
    });
  };

  const saveEdit = () => {
    if (!row) return;
    setErr(null);
    start(async () => {
      const res = await editCheck({
        id: row.id,
        result: editResult,
        tempC: eq ? temp : null,
        note,
        action,
        reason,
      });
      if (!res.ok) setErr(res.error);
      else {
        setMode("");
        router.refresh();
      }
    });
  };

  const state = row ? row.result : "none";

  return (
    <article className={`hc-card hc-card--${state}`} aria-label={r.label}>
      <header className="hc-card__head">
        <div className="hc-card__title">
          {r.label}
          {limit ? <span className="hc-card__limit">基準 {limit}</span> : null}
        </div>
        <span className={`hc-pill hc-pill--${state === "none" ? "todo" : state}`}>
          {row ? RESULT_LABEL[row.result] : "未入力"}
        </span>
      </header>

      {how ? (
        <details className="hc-how">
          <summary>確認のしかた{who ? `（${who}）` : ""}</summary>
          <p>{how}</p>
          {onProblem ? <p className="muted">問題があったら：{onProblem}</p> : null}
          {g?.hint ? <p className="muted">{g.hint}</p> : null}
        </details>
      ) : null}

      {row && mode !== "edit" ? (
        <div className="hc-rec">
          {row.temp_c != null ? <div className="hc-rec__temp">{Number(row.temp_c)}℃</div> : null}
          {row.first_result !== row.result ? (
            <div className="hc-rec__first">最初の記録：{RESULT_LABEL[row.first_result]}（修正済み）</div>
          ) : null}
          {row.note ? <div>内容：{row.note}</div> : null}
          {row.action ? <div>対応：{row.action}</div> : null}
          <div className="micro">
            {row.source === "auto" ? "温度計（自動）" : (names[row.recorded_by ?? ""] ?? "?")}・{row.source === "auto" ? "測定" : "実施"} {mdhm(row.measured_at)}
            {row.entered_late ? <span className="hc-tag">追記（入力 {mdhm(row.recorded_at)}）</span> : null}
            {row.revision > 1 ? (
              <Link className="hc-tag" href={`/haccp/history?t=haccp_checks&id=${row.id}`}>
                修正{row.revision - 1}回・履歴
              </Link>
            ) : null}
          </div>
          {canEdit(row) ? (
            <button
              type="button"
              className="linklike"
              onClick={() => {
                setMode("edit");
                setEditResult(row.result);
                setTemp(row.temp_c != null ? String(row.temp_c) : "");
                setNote(row.note ?? "");
                setAction(row.action ?? "");
                setReason("");
              }}
            >
              直す
            </button>
          ) : null}
        </div>
      ) : null}

      {!row ? (
        eq ? (
          <div className="hc-temp">
            <div className="hc-temp__row">
              <input
                className="field hc-temp__input"
                inputMode="decimal"
                type="text"
                pattern="-?[0-9]*[.]?[0-9]*"
                placeholder="温度"
                value={temp}
                onChange={(e) => setTemp(e.target.value.replace(/[^0-9.\-−]/g, "").replace("−", "-"))}
                aria-label={`${r.label}の温度`}
              />
              <span className="hc-temp__unit">℃</span>
              <button
                type="button"
                className={`btn ${tempBad ? "btn-danger" : "btn-primary"} hc-big`}
                disabled={pending || tempNum == null || !Number.isFinite(tempNum)}
                onClick={() => (tempBad ? setMode("ng") : save("ok"))}
              >
                {tempBad ? "基準外：対応を書く" : "記録"}
              </button>
            </div>
            <button type="button" className="linklike" disabled={pending} onClick={() => save("na")}>
              この設備は使っていない（該当なし）
            </button>
          </div>
        ) : (
          <div className="hc-btns">
            <button type="button" className="hc-btn hc-btn--ok" disabled={pending} onClick={() => save("ok")}>
              良好
            </button>
            <button type="button" className="hc-btn hc-btn--ng" disabled={pending} onClick={() => setMode("ng")}>
              問題あり
            </button>
            {r.allowNA ? (
              <button type="button" className="hc-btn hc-btn--na" disabled={pending} onClick={() => save("na")}>
                該当なし
              </button>
            ) : null}
          </div>
        )
      ) : null}

      {mode === "ng" ? (
        <div className="hc-ng stack">
          {onProblem ? <p className="hc-guide">計画での対応：{onProblem}</p> : null}
          <span className="field-label">問題の内容</span>
          <textarea aria-label="問題の内容" className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：庫内が12℃だった" />
          <span className="field-label">その場で行った対応</span>
          <textarea aria-label="その場で行った対応" className="field" value={action} onChange={(e) => setAction(e.target.value)} placeholder="例：扉の閉め忘れを直し、30分後に測り直す" />
          <label className="hc-toggle">
            <input type="checkbox" checked={makeIncident} onChange={(e) => setMakeIncident(e.target.checked)} />
            異常・改善の記録に残す（再確認と対応済みの確認をあとで付ける）
          </label>
          <div className="row">
            <button type="button" className="btn btn-danger" disabled={pending} onClick={() => save("ng")}>
              「問題あり」で記録
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode("")}>
              やめる
            </button>
          </div>
        </div>
      ) : null}

      {mode === "edit" && row ? (
        <div className="hc-ng stack">
          <p className="micro">直す前の内容は履歴に残ります。最初の記録（{RESULT_LABEL[row.first_result]}）は消えません。</p>
          {eq ? (
            <div className="hc-temp__row">
              <input className="field hc-temp__input" inputMode="decimal" value={temp} onChange={(e) => setTemp(e.target.value)} aria-label="温度" />
              <span className="hc-temp__unit">℃</span>
            </div>
          ) : null}
          <div className="seg">
            {(["ok", "ng", ...(r.allowNA ? ["na"] : [])] as CheckResult[]).map((v) => (
              <button key={v} type="button" className="seg__btn" aria-pressed={editResult === v} onClick={() => setEditResult(v)}>
                {RESULT_LABEL[v]}
              </button>
            ))}
          </div>
          <textarea className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="内容" />
          <textarea className="field" value={action} onChange={(e) => setAction(e.target.value)} placeholder="対応" />
          <label className="field-label">
            直す理由<span className="req">必須</span>
          </label>
          <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：温度の打ち間違い" />
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={pending} onClick={saveEdit}>
              直して保存
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode("")}>
              やめる
            </button>
          </div>
        </div>
      ) : null}

      {err ? <p className="err">{err}</p> : null}
    </article>
  );
}

// ── 重要管理（料理・仕込み単位）───────────────────────────────────

function Batches(p: Props & { late: boolean; lateAt: string }) {
  const [open, setOpen] = useState<string | null>(null);
  // 仕込みごとの記録を付ける料理だけ（付けない設定なら、この欄ごと出さない）
  const menus = p.plan!.content.menus.filter((m) => m.group && m.batchRecord);
  if (menus.length === 0 && p.batches.length === 0) return null;
  return (
    <section className="stack" aria-label="重要管理の記録">
      <h2 className="section-title">重要管理（料理・仕込みごと）</h2>
      <p className="micro">煮物・和え物など作り置きの冷却と保存は、ここで1件ずつ残します。冷却の終わりはあとから続けて入れられます。</p>
      {p.batches.map((b) => (
        <div key={b.id} className={`hc-card hc-card--${b.judgement === "ng" ? "ng" : b.judgement === "ok" ? "ok" : "none"}`}>
          <header className="hc-card__head">
            <div className="hc-card__title">
              {b.item_name}
              <span className="hc-card__limit">{GROUP_SHORT[b.cc_group]}グループ</span>
            </div>
            <span className={`hc-pill hc-pill--${b.judgement === "pending" ? "todo" : b.judgement}`}>
              {b.judgement === "ok" ? "基準どおり" : b.judgement === "ng" ? "基準外" : "途中"}
            </span>
          </header>
          {b.first_ng_at && b.judgement !== "ng" ? <div className="hc-rec__first">一度、基準外になった記録です（{mdhm(b.first_ng_at)}）</div> : null}
          <BatchSummary b={b} names={p.names} />
          {open === b.id ? (
            <BatchForm {...p} batch={b} onDone={() => setOpen(null)} />
          ) : (
            <button type="button" className="linklike" onClick={() => setOpen(b.id)}>
              続きを入れる・直す
            </button>
          )}
        </div>
      ))}
      {open === "new" ? (
        <BatchForm {...p} batch={null} onDone={() => setOpen(null)} />
      ) : (
        <button type="button" className="btn btn-block" onClick={() => setOpen("new")}>
          ＋ 仕込み・調理を記録
        </button>
      )}
    </section>
  );
}

function BatchSummary({ b, names }: { b: BatchRow; names: Record<string, string> }) {
  const v = b.vals ?? {};
  const parts: string[] = [];
  if (v.heat) parts.push(`加熱 ${v.heat.ok != null ? (v.heat.ok ? "確認OK" : "不足") : `${v.heat.tempC ?? "-"}℃・${v.heat.holdSec ?? "-"}秒`}`);
  if (v.cool) parts.push(`冷却 ${hm(v.cool.startAt)}→${hm(v.cool.endAt) || "（測定中）"} ${v.cool.endTempC != null ? `${v.cool.endTempC}℃` : ""}`);
  if (v.chill) parts.push(`冷蔵 ${v.chill.tempC}℃`);
  if (v.hotHold) parts.push(`高温保管 ${v.hotHold.tempC}℃`);
  if (v.reheat) parts.push(`再加熱 ${v.reheat.ok != null ? (v.reheat.ok ? "確認OK" : "不足") : `${v.reheat.tempC ?? "-"}℃・${v.reheat.holdSec ?? "-"}秒`}`);
  return (
    <div className="hc-rec">
      <div>{parts.join("／") || "まだ測定値がありません"}</div>
      {b.storage_place || b.use_by ? (
        <div>
          保存先：{b.storage_place ?? "-"}　使用期限：{b.use_by ? mdhm(b.use_by) : "-"}
        </div>
      ) : null}
      <div className="micro">
        実施 {names[b.performer_id ?? ""] ?? "?"}・調理 {mdhm(b.cooked_at) || "-"}
        {b.entered_late ? <span className="hc-tag">追記（入力 {mdhm(b.recorded_at)}）</span> : null}
        {b.revision > 1 ? (
          <Link className="hc-tag" href={`/haccp/history?t=haccp_batches&id=${b.id}`}>
            更新{b.revision - 1}回・履歴
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function BatchForm(p: Props & { late: boolean; lateAt: string; batch: BatchRow | null; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const menus = p.plan!.content.menus.filter((m) => m.group && (m.batchRecord || m.id === p.batch?.menu_id));
  const [menuId, setMenuId] = useState(p.batch?.menu_id ?? (menus.find((m) => m.group === "g3") ?? menus[0])?.id ?? "");
  const menu = menus.find((m) => m.id === menuId) ?? null;
  const steps: StepKey[] = menu ? stepsFor(menu.group, menu.variant) : [];
  const crit = p.batch?.criteria ?? menu?.criteria ?? {};
  const v0 = p.batch?.vals ?? {};
  const [item, setItem] = useState(p.batch?.item_name ?? "");
  const [cooked, setCooked] = useState(toLocalInput(p.batch?.cooked_at) || (p.late ? p.lateAt : ""));
  const [vals, setVals] = useState<Record<string, string>>({
    heatT: v0.heat?.tempC?.toString() ?? "",
    heatS: v0.heat?.holdSec?.toString() ?? "",
    heatOk: v0.heat?.ok == null ? "" : v0.heat.ok ? "1" : "0",
    coolS: toLocalInput(v0.cool?.startAt),
    coolE: toLocalInput(v0.cool?.endAt),
    coolT: v0.cool?.endTempC?.toString() ?? "",
    chillT: v0.chill?.tempC?.toString() ?? "",
    holdT: v0.hotHold?.tempC?.toString() ?? "",
    reT: v0.reheat?.tempC?.toString() ?? "",
    reS: v0.reheat?.holdSec?.toString() ?? "",
    reOk: v0.reheat?.ok == null ? "" : v0.reheat.ok ? "1" : "0",
  });
  const [storage, setStorage] = useState(p.batch?.storage_place ?? menu?.storage ?? "");
  const [useBy, setUseBy] = useState(toLocalInput(p.batch?.use_by));
  const [note, setNote] = useState(p.batch?.note ?? "");
  const [reason, setReason] = useState("");
  const set = (k: string) => (e: { target: { value: string } }) => setVals((s) => ({ ...s, [k]: e.target.value }));
  const nowBtn = (k: string) => (
    <button type="button" className="btn btn-sm" onClick={() => setVals((s) => ({ ...s, [k]: nowLocalInput() }))}>
      今
    </button>
  );

  const stepVals: StepValues = {
    heat: { tempC: vals.heatT === "" ? null : Number(vals.heatT), holdSec: vals.heatS === "" ? null : Number(vals.heatS), ok: vals.heatOk === "" ? null : vals.heatOk === "1" },
    cool: { startAt: fromLocalInput(vals.coolS), endAt: fromLocalInput(vals.coolE), endTempC: vals.coolT === "" ? null : Number(vals.coolT) },
    chill: { tempC: vals.chillT === "" ? null : Number(vals.chillT) },
    hotHold: { tempC: vals.holdT === "" ? null : Number(vals.holdT) },
    reheat: { tempC: vals.reT === "" ? null : Number(vals.reT), holdSec: vals.reS === "" ? null : Number(vals.reS), ok: vals.reOk === "" ? null : vals.reOk === "1" },
  };
  const live = menu ? judgeBatch(steps, crit, stepVals) : null;
  const critText = (s: StepKey): string => {
    if (s === "heat" || s === "reheat") {
      const c = crit[s];
      if (!c) return "";
      return c.mode === "visual" ? c.visual : `中心${c.minC}℃以上・${c.holdSec}秒以上`;
    }
    if (s === "cool") return crit.cool ? `${crit.cool.withinMin}分以内に${crit.cool.targetC}℃以下` : "";
    if (s === "chill") return crit.chill ? `${crit.chill.maxC}℃以下` : "";
    if (s === "hotHold") return crit.hotHold ? `${crit.hotHold.minC}℃以上` : "";
    return "";
  };
  const mark = (s: StepKey) => {
    const j = live?.steps[s];
    return j === "ok" ? <span className="hc-pill hc-pill--ok">基準内</span> : j === "ng" ? <span className="hc-pill hc-pill--ng">基準外</span> : null;
  };

  const submit = () => {
    setErr(null);
    start(async () => {
      const res = await saveBatch({
        id: p.batch?.id,
        date: p.date,
        menuId,
        itemName: item,
        cookedAt: fromLocalInput(cooked),
        vals: stepVals,
        storagePlace: storage,
        useBy: fromLocalInput(useBy),
        note,
        reason,
      });
      if (!res.ok) setErr(res.error);
      else {
        p.onDone();
        router.refresh();
      }
    });
  };

  const visual = (key: "heatOk" | "reOk") => (
    <div className="seg">
      <button type="button" className="seg__btn" aria-pressed={vals[key] === "1"} onClick={() => setVals((s) => ({ ...s, [key]: "1" }))}>確認できた</button>
      <button type="button" className="seg__btn" aria-pressed={vals[key] === "0"} onClick={() => setVals((s) => ({ ...s, [key]: "0" }))}>不足</button>
    </div>
  );

  return (
    <div className="hc-ng stack">
      {!p.batch ? (
        <>
          <span className="field-label">メニュー（計画に登録したもの）</span>
          <select aria-label="メニュー" className="field" value={menuId} onChange={(e) => setMenuId(e.target.value)}>
            {menus.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}（{GROUP_SHORT[m.group as "g1"]}）
              </option>
            ))}
          </select>
        </>
      ) : null}
      <span className="field-label">品名（仕込みの単位）</span>
      <input aria-label="品名" className="field" value={item} onChange={(e) => setItem(e.target.value)} placeholder={menu?.name ?? ""} />
      <span className="field-label">調理日時</span>
      <div className="row">
        <input aria-label="調理日時" className="field" type="datetime-local" value={cooked} onChange={(e) => setCooked(e.target.value)} />
        <button type="button" className="btn btn-sm" onClick={() => setCooked(nowLocalInput())}>今</button>
      </div>

      {steps.map((s) => (
        <fieldset key={s} className="hc-step">
          <legend>
            {STEP_LABEL[s]} <span className="micro">基準：{critText(s) || "未設定"}</span> {mark(s)}
          </legend>
          {(s === "heat" || s === "reheat") && crit[s]?.mode === "visual" ? visual(s === "heat" ? "heatOk" : "reOk") : null}
          {(s === "heat" || s === "reheat") && crit[s]?.mode !== "visual" ? (
            <div className="hc-grid2">
              <label>中心温度℃<input className="field" inputMode="decimal" value={vals[s === "heat" ? "heatT" : "reT"]} onChange={set(s === "heat" ? "heatT" : "reT")} /></label>
              <label>保持時間（秒）<input className="field" inputMode="numeric" value={vals[s === "heat" ? "heatS" : "reS"]} onChange={set(s === "heat" ? "heatS" : "reS")} /></label>
            </div>
          ) : null}
          {s === "cool" ? (
            <div className="stack">
              <label>冷却開始<div className="row"><input className="field" type="datetime-local" value={vals.coolS} onChange={set("coolS")} />{nowBtn("coolS")}</div></label>
              <label>冷却終了<div className="row"><input className="field" type="datetime-local" value={vals.coolE} onChange={set("coolE")} />{nowBtn("coolE")}</div></label>
              <label>終了時の中心温度℃<input className="field" inputMode="decimal" value={vals.coolT} onChange={set("coolT")} /></label>
            </div>
          ) : null}
          {s === "chill" ? (
            <label>保管温度℃<input className="field" inputMode="decimal" value={vals.chillT} onChange={set("chillT")} /></label>
          ) : null}
          {s === "hotHold" ? (
            <label>保管温度℃<input className="field" inputMode="decimal" value={vals.holdT} onChange={set("holdT")} /></label>
          ) : null}
        </fieldset>
      ))}

      {menu && menu.group === "g3" ? (
        <>
          <span className="field-label">保存先</span>
          <input aria-label="保存先" className="field" value={storage} onChange={(e) => setStorage(e.target.value)} />
          <span className="field-label">使用期限（店の決まり：{menu.useByRule || "未設定"}）</span>
          <input aria-label="使用期限" className="field" type="datetime-local" value={useBy} onChange={(e) => setUseBy(e.target.value)} />
        </>
      ) : null}
      <span className="field-label">メモ</span>
      <input aria-label="メモ" className="field" value={note} onChange={(e) => setNote(e.target.value)} />
      {live?.judgement === "ng" && menu?.onFail ? <p className="hc-guide">計画での対応：{menu.onFail}</p> : null}
      {p.batch ? (
        <>
          <span className="field-label">入れた値を直すときの理由（空欄を埋めるだけなら不要）</span>
          <input aria-label="入れた値を直すときの理由" className="field" value={reason} onChange={(e) => setReason(e.target.value)} />
        </>
      ) : null}
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={pending || !menu} onClick={submit}>
          保存（途中でも保存できます）
        </button>
        <button type="button" className="btn btn-ghost" onClick={p.onDone}>
          閉じる
        </button>
      </div>
      {err ? <p className="err">{err}</p> : null}
    </div>
  );
}

// ── 日締め ─────────────────────────────────────────────

function DayClose(p: Props & { missing: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (p.dayClose) {
    return (
      <section className="notice">
        この日の記録は締めてあります（{p.names[p.dayClose.closed_by] ?? "?"}・{mdhm(p.dayClose.closed_at)}
        {p.dayClose.entered_late ? "・翌営業日以降に締め" : ""}）。
        {p.dayClose.missing_count > 0 ? `締めた時点で未記録 ${p.dayClose.missing_count}件。` : ""}
        追記は引き続きできます。
      </section>
    );
  }
  return (
    <section className="card stack">
      <h2 className="section-title" style={{ margin: 0 }}>この日の記録を締める</h2>
      <p className="micro">
        深夜0時を過ぎても、朝4時まではこの営業日として締められます。
        {p.missing > 0 ? `未入力が${p.missing}件あります。締めても未入力は「未記録」のまま残ります（良好にはなりません）。` : ""}
      </p>
      <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ひとこと（任意）" />
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await closeDay(p.date, note);
            if (!r.ok) setErr(r.error);
            else router.refresh();
          })
        }
      >
        締める
      </button>
      {err ? <p className="err">{err}</p> : null}
    </section>
  );
}
