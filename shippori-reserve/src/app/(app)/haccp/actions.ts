"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { can } from "@/lib/constants";
import { todayBizDate } from "@/lib/time";
import {
  judgeBatch,
  judgeTemp,
  newPlanContent,
  planForDate,
  planIssues,
  requiredChecks,
  stepsFor,
  weekStart,
  type CheckResult,
  type PlanContent,
  type StepKey,
  type StepValues,
} from "@/lib/haccp";
import { getDaysHaccp, getIncidents, getPlans, type BatchRow, type PlanRow } from "@/lib/haccp-data";

/*
 * 衛生管理の書き込み。
 * 権限はここで見たうえで、DB でも RLS とトリガがもう一度見る（記録者・修正者・承認者は DB が auth.uid() で入れる）。
 */

export type HResult = { ok: true; id?: string } | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const t = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | null => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** DB が日本語で返した理由を取り出す */
const dbErr = (message: string | undefined, fallback: string): string => {
  const jp = message?.match(/[ぁ-んァ-ヶ一-龠「（][^\n]*/);
  return jp ? jp[0] : fallback;
};

async function me(perm: "haccp.record" | "haccp.manage" | "haccp.approve") {
  const p = await requireProfile();
  if (!can(p.role, perm)) return null;
  return p;
}

function refresh() {
  revalidatePath("/haccp", "layout");
  revalidatePath("/");
}

async function planOn(date: string): Promise<PlanRow | null> {
  return planForDate(await getPlans(), date);
}

// ── 毎日のチェック ───────────────────────────────────────

export type CheckInput = {
  date: string;
  key: string;
  result: CheckResult | "";
  tempC?: number | string | null;
  /** 実施した日時（ISO）。過去日の追記では必須 */
  measuredAt?: string | null;
  note?: string;
  action?: string;
  /** 「問題あり」のとき異常・改善の記録を作るか */
  makeIncident?: boolean;
};

export async function saveCheck(input: CheckInput): Promise<HResult> {
  const p = await me("haccp.record");
  if (!p) return { ok: false, error: "権限がありません。" };
  if (!DATE_RE.test(input.date)) return { ok: false, error: "日付が正しくありません。" };
  if (input.date > todayBizDate()) return { ok: false, error: "未来の日付には記録できません。" };

  const plan = await planOn(input.date);
  if (!plan) return { ok: false, error: "この日に使える承認済みの衛生管理計画がありません。" };
  const req = requiredChecks(plan.content).find((r) => r.key === input.key);
  if (!req) return { ok: false, error: "この日の計画に無い項目です。" };

  let result = input.result;
  const temp = num(input.tempC);
  let criteria: Record<string, unknown> | null = null;
  if (req.kind === "eq") {
    const eq = plan.content.equipment.find((e) => e.id === req.ref)!;
    criteria = { maxC: eq.maxC, minC: eq.minC, label: eq.name };
    if (result !== "na") {
      if (temp == null) return { ok: false, error: "温度を数値で入れてください。" };
      if (temp < -60 || temp > 120) return { ok: false, error: "温度の値を確かめてください。" };
      // 温度から判定する（基準外を「良好」では残せない）
      result = judgeTemp(eq, temp) ?? result;
    }
  }
  if (result !== "ok" && result !== "ng" && result !== "na") return { ok: false, error: "良好・問題あり・該当なしのどれかを選んでください。" };
  const note = t(input.note);
  const action = t(input.action);
  if (result === "ng" && !note && !action) return { ok: false, error: "問題の内容か、その場で行った対応を書いてください。" };
  if (result === "na" && !req.allowNA) return { ok: false, error: "この項目は「該当なし」にできません。" };

  const late = input.date < todayBizDate();
  const measuredAt = input.measuredAt ? new Date(input.measuredAt) : null;
  if (late && (!measuredAt || Number.isNaN(measuredAt.getTime())))
    return { ok: false, error: "過去の日の追記は、実施した日時を入れてください。" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("haccp_checks")
    .insert({
      biz_date: input.date,
      check_key: input.key,
      plan_id: plan.id,
      result,
      temp_c: result === "na" ? null : temp,
      criteria,
      measured_at: measuredAt ? measuredAt.toISOString() : null,
      note: note || null,
      action: action || null,
      // 下は DB が上書きする（画面の値は信用しない）
      first_result: result,
      recorded_by: p.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    if (error?.code === "23505") return { ok: false, error: "この項目はもう記録されています。画面を更新してください。" };
    return { ok: false, error: dbErr(error?.message, "保存できませんでした。") };
  }

  if (result === "ng" && input.makeIncident !== false) {
    await supabase.from("haccp_incidents").insert({
      biz_date: input.date,
      occurred_at: (measuredAt ?? new Date()).toISOString(),
      plan_id: plan.id,
      source: "check",
      check_id: data.id,
      category: req.kind === "eq" ? "temp" : incidentCategory(req.ref),
      target: req.kind === "eq" ? `${req.label}${temp != null ? `（${temp}℃）` : ""}` : req.label,
      problem: note || (req.kind === "eq" ? "温度が基準を外れた" : "問題あり"),
      action: action || null,
      created_by: p.id,
    });
  }
  refresh();
  return { ok: true, id: data.id };
}

function incidentCategory(ref: string): string {
  if (ref === "receiving") return "receiving";
  if (ref === "health") return "health";
  if (ref === "kitchen") return "pest";
  if (ref === "g2") return "heating";
  if (ref === "g3") return "cooling";
  return "hygiene";
}

export async function editCheck(input: {
  id: string;
  result: CheckResult;
  tempC?: number | string | null;
  measuredAt?: string | null;
  note?: string;
  action?: string;
  reason: string;
}): Promise<HResult> {
  const p = await me("haccp.record");
  if (!p) return { ok: false, error: "権限がありません。" };
  const reason = t(input.reason);
  if (!reason) return { ok: false, error: "直す理由を入れてください。" };
  const supabase = await createClient();
  const { data: cur } = await supabase.from("haccp_checks").select("*").eq("id", input.id).maybeSingle();
  if (!cur) return { ok: false, error: "記録が見つかりません。" };
  if (cur.recorded_by !== p.id && !can(p.role, "haccp.manage"))
    return { ok: false, error: "人の記録を直せるのは店長・オーナーです。" };
  let result = input.result;
  const temp = num(input.tempC);
  if (cur.criteria && result !== "na") {
    if (temp == null) return { ok: false, error: "温度を数値で入れてください。" };
    // 判定は記録したときの基準で行う（あとで計画を変えても過去の判定は変わらない）
    result = judgeTemp({ maxC: cur.criteria.maxC ?? null, minC: cur.criteria.minC ?? null }, temp) ?? result;
  }
  const note = t(input.note);
  const action = t(input.action);
  if (result === "ng" && !note && !action) return { ok: false, error: "問題の内容か、その場で行った対応を書いてください。" };
  const measuredAt = input.measuredAt ? new Date(input.measuredAt) : null;
  const { error } = await supabase
    .from("haccp_checks")
    .update({
      result,
      temp_c: result === "na" ? null : temp,
      measured_at: measuredAt && !Number.isNaN(measuredAt.getTime()) ? measuredAt.toISOString() : cur.measured_at,
      note: note || null,
      action: action || null,
      edit_reason: reason,
    })
    .eq("id", input.id);
  if (error) return { ok: false, error: dbErr(error.message, "直せませんでした。") };
  refresh();
  return { ok: true, id: input.id };
}

// ── 日締め ──────────────────────────────────────────────

export async function closeDay(date: string, note: string): Promise<HResult> {
  const p = await me("haccp.record");
  if (!p) return { ok: false, error: "権限がありません。" };
  if (!DATE_RE.test(date)) return { ok: false, error: "日付が正しくありません。" };
  const plan = await planOn(date);
  const day = (await getDaysHaccp(date, date, todayBizDate())).get(date);
  const supabase = await createClient();
  const { error } = await supabase.from("haccp_day_closes").insert({
    biz_date: date,
    plan_id: plan?.id ?? null,
    missing_count: day ? day.required - day.filled : 0,
    note: t(note) || null,
    closed_by: p.id,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "この日はもう締めてあります。" };
    return { ok: false, error: dbErr(error.message, "締められませんでした。") };
  }
  refresh();
  return { ok: true };
}

// ── 重要管理の仕込み・調理記録 ──────────────────────────────────

export type BatchInput = {
  id?: string;
  date: string;
  menuId: string;
  itemName: string;
  cookedAt?: string | null;
  vals: StepValues;
  storagePlace?: string;
  useBy?: string | null;
  note?: string;
  reason?: string;
};

function cleanVals(steps: StepKey[], v: StepValues): StepValues {
  const out: StepValues = {};
  const n = (x: unknown) => num(x);
  const iso = (x: unknown) => {
    if (typeof x !== "string" || !x) return undefined;
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  };
  const drop = <T extends object>(o: T): T | undefined => {
    const e = Object.entries(o).filter(([, x]) => x !== undefined && x !== null);
    return e.length ? (Object.fromEntries(e) as T) : undefined;
  };
  for (const s of steps) {
    if (s === "heat" || s === "reheat") {
      const x = v[s] ?? {};
      const o = drop({ tempC: n(x.tempC) ?? undefined, holdSec: n(x.holdSec) ?? undefined, at: iso(x.at), ok: typeof x.ok === "boolean" ? x.ok : undefined });
      if (o) out[s] = o;
    }
    if (s === "cool") {
      const x = v.cool ?? {};
      const o = drop({ startAt: iso(x.startAt), endAt: iso(x.endAt), endTempC: n(x.endTempC) ?? undefined });
      if (o) out.cool = o;
    }
    if (s === "chill" || s === "hotHold") {
      const x = v[s] ?? {};
      const o = drop({ tempC: n(x.tempC) ?? undefined, at: iso(x.at) });
      if (o) out[s] = o;
    }
  }
  return out;
}

export async function saveBatch(input: BatchInput): Promise<HResult> {
  const p = await me("haccp.record");
  if (!p) return { ok: false, error: "権限がありません。" };
  if (!DATE_RE.test(input.date) || input.date > todayBizDate()) return { ok: false, error: "日付が正しくありません。" };
  const supabase = await createClient();

  let cur: BatchRow | null = null;
  if (input.id) {
    const { data } = await supabase.from("haccp_batches").select("*").eq("id", input.id).maybeSingle();
    cur = (data as BatchRow) ?? null;
    if (!cur) return { ok: false, error: "記録が見つかりません。" };
  }
  const plan = cur ? (await getPlans()).find((x) => x.id === cur!.plan_id) ?? null : await planOn(input.date);
  if (!plan) return { ok: false, error: "この日に使える承認済みの衛生管理計画がありません。" };
  const menu = plan.content.menus.find((m) => m.id === (cur?.menu_id ?? input.menuId));
  if (!menu || !menu.group) return { ok: false, error: "計画に無いメニューです。" };
  const steps = stepsFor(menu.group, menu.variant);
  // 判定は、記録を作ったときに写した基準で行う
  const criteria = cur?.criteria ?? menu.criteria;
  const vals = cleanVals(steps, input.vals);
  const { judgement } = judgeBatch(steps, criteria, vals);
  const itemName = t(input.itemName) || menu.name;
  const useBy = input.useBy ? new Date(input.useBy) : null;
  const cookedAt = input.cookedAt ? new Date(input.cookedAt) : null;
  if (input.date < todayBizDate() && !cur && !cookedAt)
    return { ok: false, error: "過去の日の追記は、調理した日時を入れてください。" };

  const row = {
    item_name: itemName,
    cooked_at: cookedAt && !Number.isNaN(cookedAt.getTime()) ? cookedAt.toISOString() : null,
    vals,
    judgement,
    storage_place: t(input.storagePlace) || null,
    use_by: useBy && !Number.isNaN(useBy.getTime()) ? useBy.toISOString() : null,
    note: t(input.note) || null,
  };

  let id = cur?.id;
  if (cur) {
    const { error } = await supabase
      .from("haccp_batches")
      .update({ ...row, edit_reason: t(input.reason) || cur.edit_reason })
      .eq("id", cur.id);
    if (error) return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
  } else {
    const { data, error } = await supabase
      .from("haccp_batches")
      .insert({
        ...row,
        biz_date: input.date,
        plan_id: plan.id,
        menu_id: menu.id,
        cc_group: menu.group,
        variant: menu.variant,
        criteria,
        recorded_by: p.id,
        performer_id: p.id,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !data) return { ok: false, error: dbErr(error?.message, "保存できませんでした。") };
    id = data.id;
  }

  // 基準を外れたら、異常・改善の記録を作る（1件の仕込みに1つ）
  if (judgement === "ng" && id) {
    const { data: ex } = await supabase.from("haccp_incidents").select("id").eq("batch_id", id).limit(1);
    if (!ex || ex.length === 0) {
      const r = judgeBatch(steps, criteria, vals).steps;
      const bad = (Object.keys(r) as StepKey[]).filter((k) => r[k] === "ng");
      await supabase.from("haccp_incidents").insert({
        biz_date: cur?.biz_date ?? input.date,
        occurred_at: new Date().toISOString(),
        plan_id: plan.id,
        source: "batch",
        batch_id: id,
        category: bad.includes("cool") ? "cooling" : bad.includes("heat") || bad.includes("reheat") ? "heating" : "temp",
        target: itemName,
        problem: `${bad.map((b) => ({ heat: "加熱", cool: "冷却", chill: "冷蔵保管", hotHold: "高温保管", reheat: "再加熱" })[b]).join("・")}が管理基準を満たさなかった`,
        created_by: p.id,
      });
    }
  }
  refresh();
  return { ok: true, id };
}

// ── 異常と改善対応 ───────────────────────────────────────

export type IncidentInput = {
  id?: string;
  date?: string;
  occurredAt?: string;
  category?: string;
  target?: string;
  problem?: string;
  action?: string;
  dispositions?: string[];
  recheckAt?: string | null;
  recheckResult?: "ok" | "ng" | "" | null;
  recheckNote?: string;
  handlerId?: string | null;
  dueOn?: string | null;
  prevention?: string;
  status?: "open" | "done";
};

export async function saveIncident(input: IncidentInput): Promise<HResult> {
  const p = await me("haccp.record");
  if (!p) return { ok: false, error: "権限がありません。" };
  if (input.status === "done" && !can(p.role, "haccp.manage"))
    return { ok: false, error: "対応済みにできるのは店長・オーナーです。" };
  const supabase = await createClient();
  const recheckAt = input.recheckAt ? new Date(input.recheckAt) : null;
  const common = {
    action: t(input.action) || null,
    dispositions: (input.dispositions ?? []).map((d) => d.trim()).filter(Boolean),
    recheck_at: recheckAt && !Number.isNaN(recheckAt.getTime()) ? recheckAt.toISOString() : null,
    recheck_result: input.recheckResult || null,
    recheck_note: t(input.recheckNote) || null,
    handler_id: input.handlerId || null,
    due_on: input.dueOn && DATE_RE.test(input.dueOn) ? input.dueOn : null,
    prevention: t(input.prevention) || null,
  };
  if (input.id) {
    const { error } = await supabase
      .from("haccp_incidents")
      .update({ ...common, status: input.status ?? "open" })
      .eq("id", input.id);
    if (error) return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
    refresh();
    return { ok: true, id: input.id };
  }
  const date = input.date ?? todayBizDate();
  if (!DATE_RE.test(date) || date > todayBizDate()) return { ok: false, error: "日付が正しくありません。" };
  if (!t(input.target) || !t(input.problem)) return { ok: false, error: "対象と問題の内容を入れてください。" };
  const occurred = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (Number.isNaN(occurred.getTime())) return { ok: false, error: "発生日時が正しくありません。" };
  const plan = await planOn(date);
  const { data, error } = await supabase
    .from("haccp_incidents")
    .insert({
      ...common,
      biz_date: date,
      occurred_at: occurred.toISOString(),
      plan_id: plan?.id ?? null,
      source: "manual",
      category: input.category || "other",
      target: t(input.target),
      problem: t(input.problem),
      created_by: p.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return { ok: false, error: dbErr(error?.message, "保存できませんでした。") };
  refresh();
  return { ok: true, id: data.id };
}

// ── 計画 ───────────────────────────────────────────────

/** 下書きを作る。承認済みの版があればその写し、無ければ手引書の項目だけの雛形（誰が・設備・メニューは空） */
export async function createDraft(): Promise<HResult> {
  const p = await me("haccp.manage");
  if (!p) return { ok: false, error: "計画の下書きを作れるのは店長・オーナーです。" };
  const plans = await getPlans();
  if (plans.some((x) => x.status === "draft")) return { ok: false, error: "下書きがもうあります。" };
  const base = plans.find((x) => x.status === "approved");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("haccp_plans")
    .insert({
      version: (plans[0]?.version ?? 0) + 1,
      status: "draft",
      store_name: base?.store_name ?? "おばんざい家庭料理 しっぽり亭",
      hygiene_manager: base?.hygiene_manager ?? null,
      author_name: base?.author_name ?? null,
      effective_from: null,
      change_reason: null,
      content: base?.content ?? newPlanContent(),
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return { ok: false, error: dbErr(error?.message, "下書きを作れませんでした。") };
  refresh();
  return { ok: true, id: data.id };
}

export type DraftInput = {
  id: string;
  store_name: string;
  hygiene_manager: string;
  author_name: string;
  effective_from: string | null;
  change_reason: string;
  content: PlanContent;
};

function sanitizeContent(c: PlanContent): PlanContent {
  // 画面から届いたものを、そのまま形だけ整える（未知のキーは落とす）
  return {
    general: c.general.map((g) => ({
      key: g.key, no: g.no, label: g.label, basis: g.basis, enabled: !!g.enabled,
      timings: g.timings, who: t(g.who), how: t(g.how), onProblem: t(g.onProblem), allowNA: !!g.allowNA, hint: g.hint,
    })),
    equipment: c.equipment.map((e) => ({
      id: e.id, name: t(e.name), kind: e.kind, maxC: num(e.maxC), minC: num(e.minC), timings: e.timings, basis: t(e.basis), auto: !!e.auto,
    })),
    menus: c.menus.map((m) => ({
      ...m,
      name: t(m.name), hazards: t(m.hazards), method: t(m.method), frequency: t(m.frequency),
      storage: t(m.storage), useByRule: t(m.useByRule), onFail: t(m.onFail),
      special: { ...m.special, rawControl: t(m.special.rawControl), lowTempBasis: t(m.special.lowTempBasis) },
    })),
    cc: c.cc,
  };
}

export async function saveDraft(input: DraftInput): Promise<HResult> {
  const p = await me("haccp.manage");
  if (!p) return { ok: false, error: "計画を直せるのは店長・オーナーです。" };
  if (input.effective_from && !DATE_RE.test(input.effective_from)) return { ok: false, error: "適用開始日が正しくありません。" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("haccp_plans")
    .update({
      store_name: t(input.store_name) || null,
      hygiene_manager: t(input.hygiene_manager) || null,
      author_name: t(input.author_name) || null,
      effective_from: input.effective_from || null,
      change_reason: t(input.change_reason) || null,
      content: sanitizeContent(input.content),
    })
    .eq("id", input.id)
    .eq("status", "draft");
  if (error) return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
  refresh();
  return { ok: true, id: input.id };
}

export async function discardDraft(id: string): Promise<HResult> {
  const p = await me("haccp.manage");
  if (!p) return { ok: false, error: "権限がありません。" };
  const supabase = await createClient();
  const { error } = await supabase.from("haccp_plans").delete().eq("id", id).eq("status", "draft");
  if (error) return { ok: false, error: dbErr(error.message, "削除できませんでした。") };
  refresh();
  return { ok: true };
}

export async function approvePlan(id: string): Promise<HResult> {
  const p = await me("haccp.approve");
  if (!p) return { ok: false, error: "計画の承認はオーナーだけができます。" };
  const plan = (await getPlans()).find((x) => x.id === id);
  if (!plan || plan.status !== "draft") return { ok: false, error: "承認できる下書きがありません。" };
  const issues = planIssues(plan, plan.content);
  if (issues.length > 0) return { ok: false, error: `未設定の項目が${issues.length}件あります。先に埋めてください。` };
  if (plan.version > 1 && !t(plan.change_reason)) return { ok: false, error: "この版で何を変えたか（変更理由）を入れてください。" };
  const supabase = await createClient();
  const { error } = await supabase.from("haccp_plans").update({ status: "approved" }).eq("id", id);
  if (error) return { ok: false, error: dbErr(error.message, "承認できませんでした。") };
  refresh();
  return { ok: true, id };
}

export async function addNotice(input: { planId: string; noticedOn: string; method: string; note?: string }): Promise<HResult> {
  const p = await me("haccp.manage");
  if (!p) return { ok: false, error: "周知の記録は店長・オーナーが付けます。" };
  if (!DATE_RE.test(input.noticedOn)) return { ok: false, error: "周知した日を入れてください。" };
  if (!t(input.method)) return { ok: false, error: "周知のしかた（朝礼で読み合わせ など）を入れてください。" };
  const supabase = await createClient();
  const { error } = await supabase.from("haccp_plan_notices").insert({
    plan_id: input.planId,
    noticed_on: input.noticedOn,
    method: t(input.method),
    note: t(input.note) || null,
    recorded_by: p.id,
  });
  if (error) return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
  refresh();
  return { ok: true };
}

export async function ackPlan(planId: string): Promise<HResult> {
  const p = await me("haccp.record");
  if (!p) return { ok: false, error: "権限がありません。" };
  const supabase = await createClient();
  const { error } = await supabase.from("haccp_plan_acks").insert({ plan_id: planId, profile_id: p.id });
  if (error && error.code !== "23505") return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
  refresh();
  return { ok: true };
}

// ── 週の確認・月の振り返り ──────────────────────────────────

export async function saveReview(input: {
  kind: "week" | "month";
  periodStart: string;
  periodEnd: string;
  comment: string;
  repeatIssues?: string;
  improvements?: { task: string; owner: string; due: string; done: boolean }[];
  planReviewNeeded?: boolean;
}): Promise<HResult> {
  const p = await me("haccp.manage");
  if (!p) return { ok: false, error: "確認・振り返りは店長・オーナーが付けます。" };
  if (!DATE_RE.test(input.periodStart) || !DATE_RE.test(input.periodEnd) || input.periodEnd < input.periodStart)
    return { ok: false, error: "期間が正しくありません。" };
  if (input.kind === "week" && weekStart(input.periodStart) !== input.periodStart)
    return { ok: false, error: "週の確認は月曜始まりです。" };
  const today = todayBizDate();
  // 確認した時点の集計を一緒に残す（あとで記録が追記されても、確認した時の状態が分かる）
  const days = await getDaysHaccp(input.periodStart, input.periodEnd, today);
  const open = await getIncidents({ from: input.periodStart, to: input.periodEnd, openOnly: true });
  const summary = { complete: 0, partial: 0, none: 0, closed: 0, ng: 0, open: open.length };
  for (const d of days.values()) {
    if (d.state === "complete") summary.complete++;
    if (d.state === "partial") summary.partial++;
    if (d.state === "none") summary.none++;
    if (d.state === "closed") summary.closed++;
    summary.ng += d.ng;
  }
  const improvements = (input.improvements ?? [])
    .map((i) => ({ task: t(i.task), owner: t(i.owner), due: DATE_RE.test(i.due) ? i.due : "", done: !!i.done }))
    .filter((i) => i.task);
  const supabase = await createClient();
  const row = {
    summary,
    comment: t(input.comment) || null,
    repeat_issues: t(input.repeatIssues) || null,
    improvements,
    plan_review_needed: !!input.planReviewNeeded,
  };
  const { data: ex } = await supabase
    .from("haccp_reviews").select("id").eq("kind", input.kind).eq("period_start", input.periodStart).maybeSingle();
  const { error } = ex
    ? await supabase.from("haccp_reviews").update(row).eq("id", ex.id)
    : await supabase.from("haccp_reviews").insert({
        ...row,
        kind: input.kind,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        reviewer_id: p.id,
      });
  if (error) return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
  refresh();
  return { ok: true };
}
