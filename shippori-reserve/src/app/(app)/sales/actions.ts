"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { can } from "@/lib/constants";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type SalesActionResult = { ok: true } | { ok: false; error: string };

/**
 * 日毎の売上（目標・実績）の手入力（店長・オーナー）。
 * null は「その項目は触らない」。検査は DB関数 set_sales_day が行う。
 */
export async function setSalesDay(
  date: string,
  targetYen: number | null,
  actualYen: number | null,
): Promise<SalesActionResult> {
  const me = await requireProfile();
  if (!can(me.role, "sales.write")) return { ok: false, error: "権限がありません。" };
  if (!DATE_RE.test(date)) return { ok: false, error: "日付が不正です。" };
  for (const v of [targetYen, actualYen]) {
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > 100_000_000)) {
      return { ok: false, error: "金額が不正です。" };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_sales_day", {
    p_date: date,
    p_target: targetYen,
    p_actual: actualYen,
  });

  if (error) {
    const jp = error.message.match(/[ぁ-んァ-ヶ一-龠][^\n]*/);
    return { ok: false, error: jp ? jp[0] : "保存できませんでした。" };
  }

  revalidatePath("/");
  revalidatePath("/sales");
  return { ok: true };
}
