import "server-only";
import { createClient } from "@/lib/supabase/server";
import { deriveBusinessDay, getSettings } from "@/lib/queries";
import { shiftDate } from "@/lib/time";
import {
  dayHaccp,
  planForDate,
  requiredChecks,
  type CcGroup,
  type CheckResult,
  type DayHaccp,
  type PlanContent,
  type StepCriteria,
  type StepJudge,
  type StepValues,
} from "@/lib/haccp";

/*
 * 衛生管理の読み出し。すべて利用者のログイン（RLS）で読む。
 * 権限の無い人には DB が0行を返すので、ここで権限を見落としても中身は漏れない。
 */

export type PlanRow = {
  id: string;
  version: number;
  status: "draft" | "approved" | "superseded";
  store_name: string | null;
  hygiene_manager: string | null;
  author_name: string | null;
  effective_from: string | null;
  change_reason: string | null;
  content: PlanContent;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
  approved_by: string | null;
  approved_at: string | null;
  superseded_at: string | null;
};

export type CheckRow = {
  id: string;
  biz_date: string;
  check_key: string;
  plan_id: string;
  result: CheckResult;
  temp_c: number | null;
  criteria: { maxC?: number | null; minC?: number | null; label?: string } | null;
  measured_at: string | null;
  note: string | null;
  action: string | null;
  first_result: CheckResult;
  recorded_by: string;
  recorded_at: string;
  entered_late: boolean;
  updated_by: string | null;
  updated_at: string | null;
  edit_reason: string | null;
  revision: number;
};

export type BatchRow = {
  id: string;
  biz_date: string;
  plan_id: string;
  menu_id: string;
  item_name: string;
  cc_group: CcGroup;
  variant: string;
  cooked_at: string | null;
  vals: StepValues;
  criteria: StepCriteria | null;
  judgement: StepJudge;
  first_ng_at: string | null;
  storage_place: string | null;
  use_by: string | null;
  performer_id: string | null;
  note: string | null;
  recorded_by: string;
  recorded_at: string;
  entered_late: boolean;
  updated_by: string | null;
  updated_at: string | null;
  edit_reason: string | null;
  revision: number;
};

export type IncidentRow = {
  id: string;
  biz_date: string;
  occurred_at: string;
  plan_id: string | null;
  source: "check" | "batch" | "manual";
  check_id: string | null;
  batch_id: string | null;
  category: string;
  target: string;
  problem: string;
  action: string | null;
  dispositions: string[];
  recheck_at: string | null;
  recheck_result: "ok" | "ng" | null;
  recheck_note: string | null;
  handler_id: string | null;
  due_on: string | null;
  prevention: string | null;
  status: "open" | "done";
  confirmer_id: string | null;
  confirmed_at: string | null;
  created_by: string;
  created_at: string;
  entered_late: boolean;
  updated_by: string | null;
  updated_at: string | null;
};

export type ReviewRow = {
  id: string;
  kind: "week" | "month";
  period_start: string;
  period_end: string;
  summary: Record<string, number>;
  comment: string | null;
  repeat_issues: string | null;
  improvements: { task: string; owner: string; due: string; done: boolean }[];
  plan_review_needed: boolean;
  reviewer_id: string;
  reviewed_at: string;
  updated_by: string | null;
  updated_at: string | null;
};

export type DayCloseRow = {
  biz_date: string;
  plan_id: string | null;
  missing_count: number;
  note: string | null;
  closed_by: string;
  closed_at: string;
  entered_late: boolean;
};

export type RevisionRow = {
  id: number;
  table_name: string;
  row_id: string;
  revision: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  changed_by: string | null;
  changed_at: string;
};

function warn(where: string, error: { code?: string } | null) {
  if (error) console.error("haccp_query_failed", where, error.code ?? "?");
}

/** PostgREST は1回1000行まで。期間の記録は足りるまで取りに行く */
async function all<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string } | null }>,
  where: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await run(from, from + 999);
    warn(where, error);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function getPlans(): Promise<PlanRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("haccp_plans").select("*").order("version", { ascending: false });
  warn("getPlans", error);
  return (data ?? []) as PlanRow[];
}

export async function getChecks(from: string, to: string): Promise<CheckRow[]> {
  const supabase = await createClient();
  return all<CheckRow>(
    (a, b) =>
      supabase.from("haccp_checks").select("*").gte("biz_date", from).lte("biz_date", to)
        .order("biz_date").order("check_key").range(a, b),
    "getChecks",
  );
}

export async function getBatches(from: string, to: string): Promise<BatchRow[]> {
  const supabase = await createClient();
  return all<BatchRow>(
    (a, b) =>
      supabase.from("haccp_batches").select("*").gte("biz_date", from).lte("biz_date", to)
        .order("biz_date").order("recorded_at").range(a, b),
    "getBatches",
  );
}

export async function getIncidents(opts: { from?: string; to?: string; openOnly?: boolean }): Promise<IncidentRow[]> {
  const supabase = await createClient();
  return all<IncidentRow>((a, b) => {
    let q = supabase.from("haccp_incidents").select("*");
    if (opts.from) q = q.gte("biz_date", opts.from);
    if (opts.to) q = q.lte("biz_date", opts.to);
    if (opts.openOnly) q = q.eq("status", "open");
    return q.order("occurred_at", { ascending: false }).range(a, b);
  }, "getIncidents");
}

export async function getIncident(id: string): Promise<IncidentRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("haccp_incidents").select("*").eq("id", id).maybeSingle();
  warn("getIncident", error);
  return (data as IncidentRow) ?? null;
}

export async function getDayCloses(from: string, to: string): Promise<DayCloseRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("haccp_day_closes").select("*").gte("biz_date", from).lte("biz_date", to);
  warn("getDayCloses", error);
  return (data ?? []) as DayCloseRow[];
}

export async function getReviews(from: string, to: string): Promise<ReviewRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("haccp_reviews").select("*").gte("period_start", from).lte("period_start", to).order("period_start");
  warn("getReviews", error);
  return (data ?? []) as ReviewRow[];
}

export async function getRevisions(table: string, rowId: string): Promise<RevisionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("haccp_revisions").select("*").eq("table_name", table).eq("row_id", rowId).order("id");
  warn("getRevisions", error);
  return (data ?? []) as RevisionRow[];
}

export async function getNotices(planIds: string[]) {
  if (planIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("haccp_plan_notices").select("*").in("plan_id", planIds).order("noticed_on", { ascending: false });
  warn("getNotices", error);
  return (data ?? []) as { id: string; plan_id: string; noticed_on: string; method: string; note: string | null; recorded_by: string | null; created_at: string }[];
}

export async function getAcks(planIds: string[]) {
  if (planIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("haccp_plan_acks").select("*").in("plan_id", planIds);
  warn("getAcks", error);
  return (data ?? []) as { plan_id: string; profile_id: string; acked_at: string }[];
}

/** 期間の休業日（営業日の設定が正。行が無い日は曜日の決まり＝火曜定休） */
export async function getClosedDays(from: string, to: string): Promise<Set<string>> {
  const supabase = await createClient();
  const [{ data, error }, settings] = await Promise.all([
    supabase.from("business_days").select("biz_date, is_closed").gte("biz_date", from).lte("biz_date", to),
    getSettings(),
  ]);
  warn("getClosedDays", error);
  const saved = new Map((data ?? []).map((r) => [r.biz_date as string, r.is_closed as boolean]));
  const out = new Set<string>();
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    if (saved.get(d) ?? deriveBusinessDay(d, settings).is_closed) out.add(d);
  }
  return out;
}

/**
 * 期間の1日ごとの状態（記録完了／一部未完了／未記録／休業…と、問題・対応中の数）。
 * 暦・月の一覧・帳票で同じものを使う。
 */
export async function getDaysHaccp(
  from: string,
  to: string,
  today: string,
  pre?: { plans?: PlanRow[]; closed?: Set<string>; checks?: CheckRow[]; batches?: BatchRow[]; incidents?: IncidentRow[] },
): Promise<Map<string, DayHaccp>> {
  const [plans, closed, checks, batches, incidents] = await Promise.all([
    pre?.plans ?? getPlans(),
    pre?.closed ?? getClosedDays(from, to),
    pre?.checks ?? getChecks(from, to),
    pre?.batches ?? getBatches(from, to),
    pre?.incidents ?? getIncidents({ from, to }),
  ]);
  const byDay = new Map<string, CheckRow[]>();
  for (const c of checks) byDay.set(c.biz_date, [...(byDay.get(c.biz_date) ?? []), c]);
  const out = new Map<string, DayHaccp>();
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    const plan = planForDate(plans, d);
    const rows = byDay.get(d) ?? [];
    const ngBatches = batches.filter((b) => b.biz_date === d && b.first_ng_at).length;
    out.set(
      d,
      dayHaccp({
        date: d,
        today,
        hasPlan: !!plan,
        isClosed: closed.has(d),
        required: plan ? requiredChecks(plan.content).map((r) => r.key) : [],
        filled: rows.map((r) => r.check_key),
        ng: rows.filter((r) => r.first_result === "ng").length + ngBatches,
        open: incidents.filter((i) => i.biz_date === d && i.status === "open").length,
      }),
    );
  }
  return out;
}
