"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { can } from "@/lib/constants";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type SalesActionResult = { ok: true } | { ok: false; error: string };

/**
 * 日毎の売上（目標・実績・うち物販）の手入力（店長・オーナー）。
 * null は「その項目は触らない」。検査は DB関数 set_sales_day が行う。
 *
 * retailYen は消費税8%（持ち帰り＝物販）の売上。太巻きの日のように
 * 物販が乗った日だけ入れる。店内飲食は「実績 − 物販」で出す。
 */
export async function setSalesDay(
  date: string,
  targetYen: number | null,
  actualYen: number | null,
  retailYen: number | null = null,
): Promise<SalesActionResult> {
  const me = await requireProfile();
  if (!can(me.role, "sales.write")) return { ok: false, error: "権限がありません。" };
  if (!DATE_RE.test(date)) return { ok: false, error: "日付が不正です。" };
  for (const v of [targetYen, actualYen, retailYen]) {
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > 100_000_000)) {
      return { ok: false, error: "金額が不正です。" };
    }
  }

  const supabase = await createClient();
  const jpError = (message: string) => {
    const jp = message.match(/[ぁ-んァ-ヶ一-龠][^\n]*/);
    return { ok: false as const, error: jp ? jp[0] : "保存できませんでした。" };
  };

  const { error } = await supabase.rpc("set_sales_day", {
    p_date: date,
    p_target: targetYen,
    p_actual: actualYen,
  });

  if (error) return jpError(error.message);

  // 物販は別の関数。実績が入ったあとでないと「物販が実績を超えていないか」を
  // 見られないので、必ず set_sales_day の後に呼ぶ。
  if (retailYen !== null) {
    const { error: retailError } = await supabase.rpc("set_sales_retail", {
      p_date: date,
      p_retail: retailYen,
    });
    // 関数がまだ無い＝データベース側の更新が済んでいない。
    // 「保存できませんでした」だけだと入力を疑ってしまうので、理由を出す。
    if (retailError?.code === "PGRST202") {
      return { ok: false, error: "物販欄はまだ準備中です。目標と実績は保存できています。" };
    }
    if (retailError) return jpError(retailError.message);
  }

  revalidatePath("/");
  revalidatePath("/sales");
  return { ok: true };
}
