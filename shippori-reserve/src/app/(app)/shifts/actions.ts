"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { can } from "@/lib/constants";

const YM_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ShiftActionResult = { ok: true } | { ok: false; error: string };

/** DB関数が raise した日本語メッセージを取り出す（無ければ汎用文言） */
const rpcError = (message: string | undefined, fallback: string): string => {
  if (!message) return fallback;
  const jp = message.match(/[ぁ-んァ-ヶ一-龠][^\n]*/);
  return jp ? jp[0] : fallback;
};

/**
 * 希望シフトの提出（一般スタッフ）。
 * 締切・対象月・自分の分だけ、の検査と月まるごとの置き換えは
 * DB関数 submit_month_requests が1トランザクションで行う。
 */
export async function submitMyRequests(ym: string, dates: string[]): Promise<ShiftActionResult> {
  const me = await requireProfile();
  if (!can(me.role, "shiftrequest.write")) return { ok: false, error: "権限がありません。" };
  if (!YM_RE.test(ym)) return { ok: false, error: "月が不正です。" };
  if (dates.some((d) => !DATE_RE.test(d))) return { ok: false, error: "日付が不正です。" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_month_requests", {
    p_ym: ym,
    p_dates: dates,
  });

  if (error) return { ok: false, error: rpcError(error.message, "保存できませんでした。") };

  revalidatePath("/shifts");
  return { ok: true };
}

/**
 * シフトの確定（店長・オーナー）。
 * 月まるごとの置き換えと「確定」の記録は DB関数 confirm_month_shifts が
 * 1トランザクションで行う。途中失敗で確定シフトが消えることはない。
 */
export async function confirmMonthShifts(
  ym: string,
  assignments: { date: string; profile_id: string }[],
): Promise<ShiftActionResult> {
  const me = await requireProfile();
  if (!can(me.role, "shift.write")) return { ok: false, error: "権限がありません。" };
  if (!YM_RE.test(ym)) return { ok: false, error: "月が不正です。" };
  if (assignments.some((a) => !DATE_RE.test(a.date))) {
    return { ok: false, error: "日付が不正です。" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_month_shifts", {
    p_ym: ym,
    p_assignments: assignments,
  });

  if (error) return { ok: false, error: rpcError(error.message, "保存できませんでした。") };

  revalidatePath("/");
  revalidatePath("/shifts");
  revalidatePath("/day/[date]", "page");
  return { ok: true };
}

/**
 * 確定済みの日のシフトを差し替える（店長・オーナー）。急な休みや交代用。
 * 月が未確定なら DB関数 update_day_shifts が拒否する。
 */
export async function updateDayShifts(
  date: string,
  profileIds: string[],
): Promise<ShiftActionResult> {
  const me = await requireProfile();
  if (!can(me.role, "shift.write")) return { ok: false, error: "権限がありません。" };
  if (!DATE_RE.test(date)) return { ok: false, error: "日付が不正です。" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_day_shifts", {
    p_date: date,
    p_profile_ids: profileIds,
  });

  if (error) return { ok: false, error: rpcError(error.message, "保存できませんでした。") };

  revalidatePath("/");
  revalidatePath("/shifts");
  revalidatePath("/day/[date]", "page");
  return { ok: true };
}
