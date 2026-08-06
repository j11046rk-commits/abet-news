"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: true } | { ok: false; error: string };

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/sessions");
  revalidatePath("/ledger");
  revalidatePath("/reservations");
  revalidatePath("/calendar");
  revalidatePath("/members");
}

/** いま施設に入った。滞在中の行が既にあれば何もしない。 */
export async function checkIn(): Promise<Result> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: open } = await supabase
    .from("check_ins")
    .select("id")
    .eq("profile_id", profile.id)
    .is("checked_out_at", null)
    .maybeSingle();

  if (open) {
    revalidateAll();
    return { ok: true };
  }

  const { error } = await supabase.from("check_ins").insert({ profile_id: profile.id });
  if (error) return { ok: false, error: "チェックインできませんでした。" };

  revalidateAll();
  return { ok: true };
}

/** 施設を出た。滞在中の行に退出時刻を入れる。 */
export async function checkOut(): Promise<Result> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("check_ins")
    .update({ checked_out_at: new Date().toISOString() })
    .eq("profile_id", profile.id)
    .is("checked_out_at", null);

  if (error) return { ok: false, error: "チェックアウトできませんでした。" };

  revalidateAll();
  return { ok: true };
}
