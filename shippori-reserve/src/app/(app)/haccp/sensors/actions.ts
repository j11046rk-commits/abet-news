"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { can } from "@/lib/constants";

export type SResult = { ok: true } | { ok: false; error: string };
const ID_RE = /^[A-Za-z0-9:_-]{4,64}$/;
const EQ_RE = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * 温度計と設備（計画の equipment.id）を結びつける（店長・オーナー）。equipmentId=null は「参考に見るだけ」。
 * 1つの設備に温度計は1つ。別の温度計に付いていたら、そちらは外してから付ける。
 */
export async function setSensor(input: { deviceId: string; deviceName: string; deviceType: string; equipmentId: string | null }): Promise<SResult> {
  const me = await requireProfile();
  if (!can(me.role, "haccp.manage")) return { ok: false, error: "権限がありません。" };
  if (!ID_RE.test(input.deviceId)) return { ok: false, error: "温度計のIDが不正です。" };
  if (input.equipmentId && !EQ_RE.test(input.equipmentId)) return { ok: false, error: "設備の指定が不正です。" };
  const supabase = await createClient();
  if (input.equipmentId) {
    const { error: e1 } = await supabase
      .from("haccp_sensors")
      .update({ equipment_id: null, updated_by: me.id, updated_at: new Date().toISOString() })
      .eq("equipment_id", input.equipmentId)
      .neq("device_id", input.deviceId);
    if (e1) return { ok: false, error: "保存できませんでした。" };
  }
  const { error } = await supabase.from("haccp_sensors").upsert({
    device_id: input.deviceId,
    device_name: input.deviceName.slice(0, 80),
    device_type: input.deviceType.slice(0, 40),
    equipment_id: input.equipmentId,
    updated_by: me.id,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: "保存できませんでした。" };
  revalidatePath("/haccp/sensors");
  revalidatePath("/haccp");
  return { ok: true };
}

/** もう使わない温度計を外す（読み取った過去の値は残る） */
export async function removeSensor(deviceId: string): Promise<SResult> {
  const me = await requireProfile();
  if (!can(me.role, "haccp.manage")) return { ok: false, error: "権限がありません。" };
  const supabase = await createClient();
  const { error } = await supabase.from("haccp_sensors").delete().eq("device_id", deviceId);
  if (error) return { ok: false, error: "外せませんでした。" };
  revalidatePath("/haccp/sensors");
  return { ok: true };
}

/**
 * 温度計のLINEの知らせを止める／再開する（店長・オーナー）。
 * 再開するときは、止めていた間に付けた「知らせ済み」の印（先の日付にしたもの）を消して、必要な知らせがすぐ届くようにする。
 */
export async function setAlertsPaused(paused: boolean): Promise<SResult> {
  const me = await requireProfile();
  if (!can(me.role, "haccp.manage")) return { ok: false, error: "権限がありません。" };
  const admin = createAdminClient();
  const { error } = await admin
    .from("settings")
    .upsert({ key: "haccp_alerts_paused", value: paused, updated_by: me.id, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: "保存できませんでした。" };
  if (!paused) await admin.from("haccp_sensor_alerts").delete().gt("sent_at", new Date().toISOString());
  revalidatePath("/haccp/sensors");
  return { ok: true };
}
