import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushLine } from "@/lib/line";
import { planForDate, type Equipment, type PlanContent } from "@/lib/haccp";
import { todayBizDate } from "@/lib/time";
import { readStatus, switchbotReady } from "@/lib/switchbot";
import {
  alertText,
  bizDayStartIso,
  dailyRecord,
  decideAlerts,
  STALE_COUNT,
  type AlertKind,
  type Reading,
} from "@/lib/haccp-sensors";

/*
 * 温度計の定期処理（サーバーの管理キーで動く。画面からは呼ばない）。
 *   pollSensors … 30分ごと：全部の温度計を読んで残し、知らせを判断する
 *   autoRecord  … 毎晩：その営業日の最後の値を衛生管理の記録（eq:<設備>:close・source=auto）に書く
 */

type Sensor = { device_id: string; device_name: string; equipment_id: string | null };
type PlanRow = { id: string; version: number; status: string; effective_from: string | null; content: PlanContent };

async function livePlan(bizDate: string): Promise<PlanRow | null> {
  const { data } = await createAdminClient()
    .from("haccp_plans")
    .select("id, version, status, effective_from, content")
    .in("status", ["approved", "superseded"]);
  return (planForDate((data ?? []) as PlanRow[], bizDate) as PlanRow | null) ?? null;
}

export async function pollSensors(): Promise<{ read: number; failed: string[]; alerts: number; skipped?: string }> {
  if (!switchbotReady()) return { read: 0, failed: [], alerts: 0, skipped: "no-switchbot-key" };
  const admin = createAdminClient();
  const { data: sensors } = await admin.from("haccp_sensors").select("device_id, device_name, equipment_id");
  const list = (sensors ?? []) as Sensor[];
  if (list.length === 0) return { read: 0, failed: [], alerts: 0, skipped: "no-sensors" };

  const plan = await livePlan(todayBizDate());
  const eqOf = (id: string | null): Equipment | null => (id && plan ? plan.content.equipment.find((e) => e.id === id) ?? null : null);
  const now = new Date();
  let read = 0;
  let alerts = 0;
  const failed: string[] = [];

  const { data: sentRows } = await admin.from("haccp_sensor_alerts").select("device_id, kind, sent_at");
  const sentBy = new Map<string, Partial<Record<AlertKind, string>>>();
  for (const s of (sentRows ?? []) as { device_id: string; kind: AlertKind; sent_at: string }[]) {
    sentBy.set(s.device_id, { ...(sentBy.get(s.device_id) ?? {}), [s.kind]: s.sent_at });
  }
  const mark = (device_id: string, kind: AlertKind) =>
    admin.from("haccp_sensor_alerts").upsert({ device_id, kind, sent_at: now.toISOString() });

  for (const s of list) {
    const eq = eqOf(s.equipment_id);
    const name = eq?.name ?? (s.device_name || s.device_id);
    try {
      const st = await readStatus(s.device_id);
      await admin.from("haccp_temp_readings").insert({
        device_id: s.device_id,
        equipment_id: s.equipment_id,
        temp_c: st.temperature,
        humidity: st.humidity,
        battery: st.battery,
        read_at: now.toISOString(),
      });
      read++;
      await admin.from("haccp_sensor_alerts").delete().eq("device_id", s.device_id).eq("kind", "error");
    } catch (e) {
      console.error("[switchbot] read failed", s.device_id, String((e as Error).message));
      failed.push(name);
      const sent = sentBy.get(s.device_id) ?? {};
      if (s.equipment_id && (!sent.error || now.getTime() - Date.parse(sent.error) >= 6 * 3600_000)) {
        if (await pushLine(alertText("error", name, null, null))) alerts++;
        await mark(s.device_id, "error");
      }
      continue;
    }

    const { data: recent } = await admin
      .from("haccp_temp_readings")
      .select("temp_c, humidity, battery, read_at")
      .eq("device_id", s.device_id)
      .order("read_at", { ascending: false })
      .limit(STALE_COUNT);
    const rs = ((recent ?? []) as Reading[]).map((r) => ({ ...r, temp_c: Number(r.temp_c) }));
    const limits = eq ? { maxC: eq.maxC, minC: eq.minC } : null;
    const sent = sentBy.get(s.device_id) ?? {};
    const { send, recovered } = decideAlerts(rs, limits, sent, now);
    for (const k of send) {
      if (await pushLine(alertText(k, name, rs[0] ?? null, limits))) alerts++;
      await mark(s.device_id, k);
    }
    if (recovered) {
      if (await pushLine(alertText("recovered", name, rs[0] ?? null, limits))) alerts++;
      await admin.from("haccp_sensor_alerts").delete().eq("device_id", s.device_id).eq("kind", "out_of_range");
    }
  }
  return { read, failed, alerts };
}

/**
 * 毎晩：その営業日（朝4時区切り）の値から、温度計の設備ぶんの記録を書く。
 * すでに記録がある設備（人が手で入れた等）は触らない。値が無かった設備は店のLINEに知らせる。
 */
export async function autoRecord(): Promise<{ date: string; written: string[]; missing: string[]; skipped?: string }> {
  const bizDate = todayBizDate();
  const plan = await livePlan(bizDate);
  if (!plan) return { date: bizDate, written: [], missing: [], skipped: "no-plan" };
  const autoEq = plan.content.equipment.filter((e) => e.auto);
  if (autoEq.length === 0) return { date: bizDate, written: [], missing: [], skipped: "no-auto-equipment" };

  const admin = createAdminClient();
  const { data: existing } = await admin.from("haccp_checks").select("check_key").eq("biz_date", bizDate);
  const have = new Set((existing ?? []).map((r) => r.check_key as string));
  const written: string[] = [];
  const missing: string[] = [];

  for (const e of autoEq) {
    const key = `eq:${e.id}:close`;
    if (have.has(key)) continue;
    const { data } = await admin
      .from("haccp_temp_readings")
      .select("temp_c, humidity, battery, read_at")
      .eq("equipment_id", e.id)
      .gte("read_at", bizDayStartIso(bizDate))
      .order("read_at", { ascending: true })
      .limit(500);
    const rs = ((data ?? []) as Reading[]).map((r) => ({ ...r, temp_c: Number(r.temp_c) }));
    const rec = dailyRecord(rs, { maxC: e.maxC, minC: e.minC });
    if (!rec) {
      missing.push(e.name);
      continue;
    }
    const { error } = await admin.from("haccp_checks").insert({
      biz_date: bizDate,
      check_key: key,
      plan_id: plan.id,
      result: rec.result,
      temp_c: rec.temp_c,
      criteria: { maxC: e.maxC, minC: e.minC, label: e.name },
      measured_at: rec.measured_at,
      note: rec.note,
      source: "auto",
      recorded_by: null,
    });
    if (error) {
      console.error("[haccp-auto] insert failed", e.id, error.message);
      missing.push(e.name);
    } else written.push(e.name);
  }

  if (missing.length > 0) {
    await pushLine(
      `🌡 今日の冷蔵庫・冷凍庫の温度を自動で記録できませんでした：${missing.join("・")}\n温度計の値が届いていません。アプリの「衛生」→「今日のチェック」で前の日（‹）を開くと、手で記録できます。`,
    );
  }
  return { date: bizDate, written, missing };
}
