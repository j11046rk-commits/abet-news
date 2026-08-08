"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { can } from "@/lib/constants";
import { isRequestWindowOpen, REQUEST_DEADLINE_DAY, requestTargetYm } from "@/lib/shifts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ShiftActionResult = { ok: true } | { ok: false; error: string };

/**
 * 確定シフトを入れる・外す（店長・オーナーのみ）。
 * オーナー3名はシフトに入らないので、対象にできない。
 */
export async function toggleConfirmedShift(
  date: string,
  profileId: string,
): Promise<ShiftActionResult> {
  const me = await requireProfile();
  if (!can(me.role, "shift.write")) return { ok: false, error: "権限がありません。" };
  if (!DATE_RE.test(date)) return { ok: false, error: "日付が不正です。" };

  const supabase = await createClient();

  const { data: target } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", profileId)
    .maybeSingle<{ role: string; is_active: boolean }>();
  if (!target || !target.is_active) return { ok: false, error: "対象のスタッフが見つかりません。" };
  if (target.role === "owner") return { ok: false, error: "オーナーはシフトに入りません。" };

  const { data: existing } = await supabase
    .from("shifts")
    .select("profile_id")
    .eq("biz_date", date)
    .eq("profile_id", profileId)
    .maybeSingle();

  const { error } = existing
    ? await supabase.from("shifts").delete().eq("biz_date", date).eq("profile_id", profileId)
    : await supabase
        .from("shifts")
        .insert({ biz_date: date, profile_id: profileId, created_by: me.id });

  if (error) return { ok: false, error: "変更できませんでした。" };

  revalidatePath("/");
  revalidatePath("/shifts");
  revalidatePath(`/day/${date}`);
  return { ok: true };
}

/**
 * 自分の希望シフトを出す・取り下げる（一般スタッフのみ）。
 * 対象は翌月分だけ。毎月25日を過ぎると締め切り。
 */
export async function toggleMyRequest(date: string): Promise<ShiftActionResult> {
  const me = await requireProfile();
  if (!can(me.role, "shiftrequest.write")) return { ok: false, error: "権限がありません。" };
  if (!DATE_RE.test(date)) return { ok: false, error: "日付が不正です。" };

  if (date.slice(0, 7) !== requestTargetYm()) {
    return { ok: false, error: "希望を出せるのは来月分だけです。" };
  }
  if (!isRequestWindowOpen()) {
    return {
      ok: false,
      error: `来月分の提出は毎月${REQUEST_DEADLINE_DAY}日で締め切りです。変更は店長に伝えてください。`,
    };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("shift_requests")
    .select("profile_id")
    .eq("biz_date", date)
    .eq("profile_id", me.id)
    .maybeSingle();

  const { error } = existing
    ? await supabase
        .from("shift_requests")
        .delete()
        .eq("biz_date", date)
        .eq("profile_id", me.id)
    : await supabase.from("shift_requests").insert({ biz_date: date, profile_id: me.id });

  if (error) return { ok: false, error: "変更できませんでした。" };

  revalidatePath("/shifts");
  return { ok: true };
}
