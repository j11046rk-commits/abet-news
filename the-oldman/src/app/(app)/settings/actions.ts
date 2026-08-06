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

/* ── 固定費マスタ ────────────────────────────────────────────────────── */

/**
 * 家賃・共益費の金額と計上日。ここで決めた日に台帳へ自動で載る（0009）。
 * 台帳の行を直すのではなくマスタを直す — 毎月の定義を変える操作だから。
 */
export async function upsertFixedCost(input: {
  id?: string;
  name: string;
  category: string;
  amountYen: number;
  billingDay: number;
  isActive: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireOwner();

  if (!input.name.trim()) return { ok: false, error: "名称を入力してください。" };
  if (!Number.isInteger(input.amountYen) || input.amountYen < 0)
    return { ok: false, error: "金額を入力してください。" };
  if (input.billingDay < 1 || input.billingDay > 28)
    return { ok: false, error: "計上日は1〜28で指定してください。" };

  const supabase = await createClient();
  const row = {
    name: input.name.trim(),
    category: input.category,
    amount_yen: input.amountYen,
    billing_day: input.billingDay,
    is_active: input.isActive,
  };

  const { error } = input.id
    ? await supabase.from("fixed_costs").update(row).eq("id", input.id)
    : await supabase.from("fixed_costs").insert(row);

  if (error) return { ok: false, error: "保存できませんでした。" };
  revalidatePath("/settings");
  revalidatePath("/ledger");
  revalidatePath("/");
  return { ok: true };
}
