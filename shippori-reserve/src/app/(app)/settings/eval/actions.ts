"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { can, worksShifts } from "@/lib/constants";
import { getStarRows } from "@/lib/store-eval-data";
import { STARS_PER_EXCHANGE, starsAvailable } from "@/lib/store-eval";

/*
 * 店舗評価の目標（オーナー）と、達成貢献⭐の交換（本人が申請・店長が「交換しました」）。
 * 書き込みはサーバーの管理キーで行う（権限はここで見る。star_redemptions には書き込みの方針を置いていない）。
 */

export type EResult = { ok: true } | { ok: false; error: string };

const done = () => {
  revalidatePath("/settings/eval");
  revalidatePath("/sales");
};

/** 目標（人件費率・1時間あたりの人件費の目安・原価率）。オーナーだけ */
export async function saveEvalTargets(input: { laborRatio: number; hourCost: number; costRatio: number | null }): Promise<EResult> {
  const me = await requireProfile();
  if (me.role !== "owner") return { ok: false, error: "目標を変えられるのはオーナーだけです。" };
  const okNum = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi;
  if (!okNum(input.laborRatio, 5, 60)) return { ok: false, error: "人件費率の目標は5〜60%で入れてください。" };
  if (!okNum(input.hourCost, 500, 5000)) return { ok: false, error: "1時間あたりの人件費の目安は500〜5,000円で入れてください。" };
  if (input.costRatio != null && !okNum(input.costRatio, 5, 80)) return { ok: false, error: "原価率の目標は5〜80%で入れてください。" };
  const now = new Date().toISOString();
  const rows = [
    { key: "eval_labor_ratio", value: input.laborRatio, updated_by: me.id, updated_at: now },
    { key: "eval_hour_cost", value: input.hourCost, updated_by: me.id, updated_at: now },
    ...(input.costRatio != null ? [{ key: "eval_cost_ratio", value: input.costRatio, updated_by: me.id, updated_at: now }] : []),
  ];
  const admin = createAdminClient();
  const { error } = await admin.from("settings").upsert(rows);
  if (error) return { ok: false, error: "保存できませんでした。" };
  // settings.value は not null。原価率の目標を空欄（未設定）にしたら行を消す
  if (input.costRatio == null) {
    const { error: e2 } = await admin.from("settings").delete().eq("key", "eval_cost_ratio");
    if (e2) return { ok: false, error: "保存できませんでした。" };
  }
  done();
  return { ok: true };
}

/**
 * 月の人件費の合計（店全体の1つの数字だけ）。オーナーだけ。空欄で消す（その月は推定に戻る）。
 * 個人の額は受け取らない（店主指示 2026-11-09「個人の人件費はちゃんと隠して」）。
 */
export async function saveLaborCost(ym: string, total: number | null): Promise<EResult> {
  const me = await requireProfile();
  if (me.role !== "owner") return { ok: false, error: "人件費の合計を入れられるのはオーナーだけです。" };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return { ok: false, error: "月が不正です。" };
  const admin = createAdminClient();
  if (total == null) {
    const { error } = await admin.from("labor_cost_monthly").delete().eq("ym", ym);
    if (error) return { ok: false, error: "消せませんでした。" };
  } else {
    if (!Number.isInteger(total) || total < 0 || total > 100_000_000) return { ok: false, error: "人件費の合計は円の整数で入れてください。" };
    const { error } = await admin
      .from("labor_cost_monthly")
      .upsert({ ym, total_yen: total, source: "manual", note: null, updated_by: me.id, updated_at: new Date().toISOString() });
    if (error) return { ok: false, error: "保存できませんでした。" };
  }
  done();
  return { ok: true };
}

/** ⭐の交換を始める／止める（申請ボタンを出すか）。オーナーだけ。既定は止めている（店主指示「まだ掲載しないで」） */
export async function setStarExchange(enabled: boolean): Promise<EResult> {
  const me = await requireProfile();
  if (me.role !== "owner") return { ok: false, error: "オーナーだけが切り替えられます。" };
  const { error } = await createAdminClient()
    .from("settings")
    .upsert({ key: "star_exchange_enabled", value: enabled, updated_by: me.id, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: "保存できませんでした。" };
  done();
  return { ok: true };
}

/** 本人が交換を申請（使える⭐が100以上・交換を始めているときだけ） */
export async function requestStarExchange(): Promise<EResult> {
  const me = await requireProfile();
  if (!worksShifts(me.role)) return { ok: false, error: "シフトに入る人だけが申請できます。" };
  const admin = createAdminClient();
  const { data: flag } = await admin.from("settings").select("value").eq("key", "star_exchange_enabled").maybeSingle();
  if (flag?.value !== true) return { ok: false, error: "まだ交換は始まっていません。" };
  const mine = (await getStarRows()).get(me.id);
  if (mine?.openRequestId) return { ok: false, error: "申請中のものがあります。店長が交換するまでお待ちください。" };
  if (starsAvailable(mine?.earned ?? 0, mine?.used ?? 0, mine?.requested ?? 0) < STARS_PER_EXCHANGE) {
    return { ok: false, error: `⭐が${STARS_PER_EXCHANGE}個たまってから申請できます。` };
  }
  const { error } = await admin.from("star_redemptions").insert({ profile_id: me.id, stars: STARS_PER_EXCHANGE });
  if (error) return { ok: false, error: error.code === "23505" ? "申請中のものがあります。" : "申請できませんでした。" };
  done();
  return { ok: true };
}

/** 店長（またはオーナー）が渡したら「交換しました」→ ⭐100が減る */
export async function markStarExchanged(id: string): Promise<EResult> {
  const me = await requireProfile();
  if (!can(me.role, "shift.write")) return { ok: false, error: "店長・オーナーだけが記録できます。" };
  const { data, error } = await createAdminClient()
    .from("star_redemptions")
    .update({ status: "done", done_by: me.id, done_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "requested")
    .select("id");
  if (error || !data?.length) return { ok: false, error: "記録できませんでした（もう交換済みかもしれません）。" };
  done();
  return { ok: true };
}

/** 申請を取り下げる（本人、または店長・オーナー） */
export async function cancelStarRequest(id: string): Promise<EResult> {
  const me = await requireProfile();
  const admin = createAdminClient();
  const { data: row } = await admin.from("star_redemptions").select("profile_id, status").eq("id", id).maybeSingle();
  if (!row || row.status !== "requested") return { ok: false, error: "申請中のものが見つかりません。" };
  if (row.profile_id !== me.id && !can(me.role, "shift.write")) return { ok: false, error: "権限がありません。" };
  const { error } = await admin.from("star_redemptions").update({ status: "cancelled" }).eq("id", id).eq("status", "requested");
  if (error) return { ok: false, error: "取り下げられませんでした。" };
  done();
  return { ok: true };
}
