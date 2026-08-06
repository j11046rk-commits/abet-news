"use server";

import { revalidatePath } from "next/cache";
import { requireOwner, requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, nowJst } from "@/lib/time";
import type { LedgerDirection } from "@/lib/types";

export type LedgerInput = {
  entryDate: string;
  direction: LedgerDirection;
  category: string;
  amountYen: number;
  memo: string;
};

export type Result = { ok: true } | { ok: false; error: string };

function revalidateAll() {
  revalidatePath("/ledger");
  revalidatePath("/");
}

/** 記帳は6人全員ができる。会計を一人に属人化させないため（SPEC §1 G4）。 */
export async function createLedgerEntry(input: LedgerInput): Promise<Result> {
  const me = await requireProfile();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate)) return { ok: false, error: "日付を選んでください。" };
  if (!input.category) return { ok: false, error: "カテゴリを選んでください。" };
  if (!Number.isInteger(input.amountYen) || input.amountYen < 0)
    return { ok: false, error: "金額を入力してください。" };

  const supabase = await createClient();
  const { error } = await supabase.from("ledger_entries").insert({
    entry_date: input.entryDate,
    direction: input.direction,
    category: input.category,
    amount_yen: input.amountYen,
    memo: input.memo.trim() || null,
    created_by: me.id,
  });

  if (error) return { ok: false, error: "記帳できませんでした。" };
  revalidateAll();
  return { ok: true };
}

/**
 * 編集も6人全員。他人が起票した行も直せる。
 * セッション由来の行（session_id あり）はここでは触れない — RLS でも弾いている。
 */
export async function updateLedgerEntry(id: string, input: LedgerInput): Promise<Result> {
  await requireProfile();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate)) return { ok: false, error: "日付を選んでください。" };
  if (!input.category) return { ok: false, error: "カテゴリを選んでください。" };
  if (!Number.isInteger(input.amountYen) || input.amountYen < 0)
    return { ok: false, error: "金額を入力してください。" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ledger_entries")
    .update({
      entry_date: input.entryDate,
      direction: input.direction,
      category: input.category,
      amount_yen: input.amountYen,
      memo: input.memo.trim() || null,
    })
    .eq("id", id)
    .is("session_id", null)
    .select("id");

  if (error) return { ok: false, error: "更新できませんでした。" };
  if (!data || data.length === 0)
    return { ok: false, error: "この行は編集できません（卓から自動で起票された行です）。" };

  revalidateAll();
  return { ok: true };
}

export async function deleteLedgerEntry(id: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase
    .from("ledger_entries")
    .delete()
    .eq("id", id)
    .is("session_id", null);
  if (error) return { ok: false, error: "削除できませんでした。" };
  revalidateAll();
  return { ok: true };
}

/**
 * 当月ぶんの固定費をまとめて計上する。
 * cron を持たない構成なので、台帳を開いた owner が押す方式にしている（SPEC §3-4）。
 * 同月・同カテゴリ・同名の行が既にあればスキップするので、二度押しても増えない。
 */
export async function postFixedCosts(): Promise<{ ok: boolean; posted: number; error?: string }> {
  const me = await requireProfile();
  const supabase = await createClient();

  const { data: costs } = await supabase.from("fixed_costs").select("*").eq("is_active", true);
  if (!costs || costs.length === 0) return { ok: true, posted: 0 };

  const today = nowJst();
  const ym = fmtDate(today).slice(0, 7);

  const { data: existing } = await supabase
    .from("ledger_entries")
    .select("memo, entry_date, direction")
    .gte("entry_date", `${ym}-01`)
    .lte("entry_date", `${ym}-31`)
    .eq("direction", "expense");

  const already = new Set((existing ?? []).map((e) => (e as { memo: string | null }).memo));

  const rows = (costs as { name: string; amount_yen: number; billing_day: number }[])
    .filter((c) => !already.has(c.name))
    .map((c) => ({
      entry_date: `${ym}-${String(c.billing_day).padStart(2, "0")}`,
      direction: "expense" as const,
      category: categoryOf(c.name),
      amount_yen: c.amount_yen,
      memo: c.name,
      created_by: me.id,
    }));

  if (rows.length === 0) return { ok: true, posted: 0 };

  const { error } = await supabase.from("ledger_entries").insert(rows);
  if (error) return { ok: false, posted: 0, error: "計上できませんでした。" };

  revalidateAll();
  return { ok: true, posted: rows.length };
}

function categoryOf(name: string): string {
  if (name.includes("家賃")) return "rent";
  if (name.includes("光熱")) return "utilities";
  return "other";
}

/* ── 固定費マスタ（owner のみ。毎月の金額の定義を変える操作のため）─────── */

export async function upsertFixedCost(input: {
  id?: string;
  name: string;
  amountYen: number;
  billingDay: number;
  isActive: boolean;
}): Promise<Result> {
  await requireOwner();

  if (!input.name.trim()) return { ok: false, error: "名称を入力してください。" };
  if (!Number.isInteger(input.amountYen) || input.amountYen < 0)
    return { ok: false, error: "金額を入力してください。" };
  if (input.billingDay < 1 || input.billingDay > 28)
    return { ok: false, error: "計上日は1〜28で指定してください。" };

  const supabase = await createClient();
  const row = {
    name: input.name.trim(),
    amount_yen: input.amountYen,
    billing_day: input.billingDay,
    is_active: input.isActive,
  };

  const { error } = input.id
    ? await supabase.from("fixed_costs").update(row).eq("id", input.id)
    : await supabase.from("fixed_costs").insert(row);

  if (error) return { ok: false, error: "保存できませんでした。" };
  revalidateAll();
  return { ok: true };
}

export async function deleteFixedCost(id: string): Promise<Result> {
  await requireOwner();
  const supabase = await createClient();
  const { error } = await supabase.from("fixed_costs").delete().eq("id", id);
  if (error) return { ok: false, error: "削除できませんでした。" };
  revalidateAll();
  return { ok: true };
}
