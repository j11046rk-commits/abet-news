"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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
    .is("fixed_cost_id", null)
    .select("id");

  if (error) return { ok: false, error: "更新できませんでした。" };
  if (!data || data.length === 0)
    return {
      ok: false,
      error: "この行は編集できません（卓や固定費から自動で起票された行です）。",
    };

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
    .is("session_id", null)
    .is("fixed_cost_id", null);
  if (error) return { ok: false, error: "削除できませんでした。" };
  revalidateAll();
  return { ok: true };
}

/* ── 立替 ───────────────────────────────────────────────────────────── */

export async function createAdvance(input: {
  profileId: string;
  title: string;
  amountYen: number;
  dueOn: string | null;
}): Promise<Result> {
  const me = await requireProfile();

  if (!input.title.trim()) return { ok: false, error: "名目を入力してください。" };
  if (!Number.isInteger(input.amountYen) || input.amountYen <= 0)
    return { ok: false, error: "金額を入力してください。" };
  if (input.dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn))
    return { ok: false, error: "精算予定日の形式が正しくありません。" };

  const supabase = await createClient();
  const { error } = await supabase.from("advances").insert({
    profile_id: input.profileId,
    title: input.title.trim(),
    amount_yen: input.amountYen,
    due_on: input.dueOn,
    created_by: me.id,
  });

  if (error) return { ok: false, error: "保存できませんでした。" };
  revalidateAll();
  return { ok: true };
}

/** チェックの付け外し。精算日は押した時刻をそのまま入れる。 */
export async function setAdvanceSettled(id: string, settled: boolean): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase
    .from("advances")
    .update({ settled_at: settled ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { ok: false, error: "更新できませんでした。" };
  revalidateAll();
  return { ok: true };
}

export async function deleteAdvance(id: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from("advances").delete().eq("id", id);
  if (error) return { ok: false, error: "削除できませんでした。" };
  revalidateAll();
  return { ok: true };
}
