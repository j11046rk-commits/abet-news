"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type SettingsInput = {
  facilityName: string;
  monthlyTargetYen: number;
  ownerCount: number;
  rakeRule: string;
};

export async function updateSettings(
  input: SettingsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireOwner();

  if (!input.facilityName.trim()) return { ok: false, error: "施設名を入力してください。" };
  if (!Number.isInteger(input.monthlyTargetYen) || input.monthlyTargetYen <= 0)
    return { ok: false, error: "月次目標額は1円以上で入力してください。" };
  if (!Number.isInteger(input.ownerCount) || input.ownerCount <= 0)
    return { ok: false, error: "オーナー人数は1以上で入力してください。" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("settings")
    .update({
      facility_name: input.facilityName.trim(),
      monthly_target_yen: input.monthlyTargetYen,
      owner_count: input.ownerCount,
      rake_rule: input.rakeRule.trim() || null,
    })
    .eq("id", true);

  if (error) return { ok: false, error: "保存できませんでした。" };

  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/ledger");
  return { ok: true };
}
