"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { can } from "@/lib/constants";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ShiftResult = { ok: true } | { ok: false; error: string };

/**
 * その日のシフトに入れる／外す。
 * シフトは「入っている／いない」の2状態しかないので、行の有無だけで持つ。
 */
export async function toggleShift(date: string, profileId: string): Promise<ShiftResult> {
  const me = await requireProfile();
  if (!can(me.role, "shift.write")) return { ok: false, error: "権限がありません。" };
  if (!DATE_RE.test(date)) return { ok: false, error: "日付が不正です。" };

  const supabase = await createClient();
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
  revalidatePath(`/day/${date}`);
  return { ok: true };
}
