import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { planForDate } from "@/lib/haccp";
import { getPlans } from "@/lib/haccp-data";
import { listThermometers, readStatus, switchbotReady, type SbDevice } from "@/lib/switchbot";
import { todayBizDate } from "@/lib/time";
import HaccpTabs from "../HaccpTabs";
import SensorList, { type SensorView } from "./SensorList";
import AlertSwitch from "./AlertSwitch";

export const dynamic = "force-dynamic";

/**
 * 温度計（SwitchBot）の一覧（衛生の記録をつける人全員）と、冷蔵庫・冷凍庫との結びつけ（店長・オーナー・0068）。
 * 一覧と「いまの温度」は SwitchBot から直接読む（開いたときだけ）。
 */
export default async function SensorsPage() {
  // 見るのは衛生の記録をつける人全員。温度計と設備の結びつけ（場所を変える）は店長・オーナーだけ
  const me = await requirePermission("haccp.record");
  const canManage = can(me.role, "haccp.manage");
  const today = todayBizDate();
  const plans = await getPlans();
  const plan = planForDate(plans, today);
  // 並びは 冷蔵庫①②③ → 冷凍庫①②③（店主指定 2026-11-08）。同じ種類の中は計画の順
  const kindOrder = (k: string) => (k === "fridge" ? 0 : k === "freezer" ? 1 : 2);
  // 承認済みで適用開始が先の版（例：11/13から）で増える設備も、前もって温度計を結びつけられるようにする
  // （承認したのに選べない、と店主指摘・2026-11-12）。基準の判定・自動記録は適用開始日から
  const upcoming = plans
    .filter((x) => x.status === "approved" && x.effective_from && x.effective_from > today)
    .sort((a, b) => a.effective_from!.localeCompare(b.effective_from!))[0];
  const nowEq = (plan?.content.equipment ?? []).map((e) => ({ ...e, from: null as string | null }));
  const laterEq = (upcoming?.content.equipment ?? [])
    .filter((e) => !nowEq.some((x) => x.id === e.id))
    .map((e) => ({ ...e, from: upcoming!.effective_from }));
  const equipment = [...nowEq, ...laterEq]
    .map((e, i) => ({ id: e.id, name: e.name, auto: !!e.auto, kind: e.kind as string, maxC: e.maxC, minC: e.minC, from: e.from, i }))
    .sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || a.i - b.i);

  const supabase = await createClient();
  const { data: pausedRow } = await supabase.from("settings").select("value").eq("key", "haccp_alerts_paused").maybeSingle();
  const paused = pausedRow?.value === true;
  const { data: saved } = await supabase.from("haccp_sensors").select("device_id, device_name, device_type, equipment_id");
  const savedBy = new Map((saved ?? []).map((s) => [s.device_id as string, s]));

  let devices: SbDevice[] = [];
  let apiError: string | null = null;
  const ready = switchbotReady();
  if (ready) {
    try {
      devices = await listThermometers();
    } catch (e) {
      apiError = String((e as Error).message || e);
    }
  }
  const live = await Promise.allSettled(devices.map((d) => readStatus(d.deviceId)));
  const { data: lastRows } = await supabase
    .from("haccp_temp_readings")
    .select("device_id, read_at")
    .order("read_at", { ascending: false })
    .limit(200);
  const lastAt = new Map<string, string>();
  for (const r of lastRows ?? []) if (!lastAt.has(r.device_id as string)) lastAt.set(r.device_id as string, r.read_at as string);

  const views: SensorView[] = devices.map((d, i) => {
    const st = live[i]!;
    return {
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      deviceType: d.deviceType,
      cloud: d.enableCloudService !== false,
      equipmentId: (savedBy.get(d.deviceId)?.equipment_id as string | null) ?? null,
      registered: savedBy.has(d.deviceId),
      temp: st.status === "fulfilled" ? st.value.temperature : null,
      battery: st.status === "fulfilled" ? st.value.battery : null,
      error: st.status === "rejected" ? String((st.reason as Error)?.message ?? st.reason) : null,
      lastSavedAt: lastAt.get(d.deviceId) ?? null,
    };
  });
  // SwitchBot から消えたが、まだ登録が残っている温度計
  for (const s of saved ?? []) {
    if (!devices.some((d) => d.deviceId === s.device_id)) {
      views.push({
        deviceId: s.device_id as string,
        deviceName: (s.device_name as string) || (s.device_id as string),
        deviceType: s.device_type as string,
        cloud: false,
        equipmentId: (s.equipment_id as string | null) ?? null,
        registered: true,
        temp: null,
        battery: null,
        error: ready && !apiError ? "SwitchBotの一覧にありません" : null,
        lastSavedAt: lastAt.get(s.device_id as string) ?? null,
      });
    }
  }

  // 結びつけた設備の順（冷蔵→冷凍）、結びつけていない温度計は最後に名前順
  const rank = new Map(equipment.map((e, i) => [e.id, i]));
  views.sort(
    (a, b) =>
      (a.equipmentId != null ? (rank.get(a.equipmentId) ?? 50) : 99) - (b.equipmentId != null ? (rank.get(b.equipmentId) ?? 50) : 99) ||
      a.deviceName.localeCompare(b.deviceName, "ja"),
  );

  return (
    <>
      <header className="appbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-face-96.png" alt="しっぽり亭" width={96} height={96} className="appbar__logo" />
        <div className="appbar__title">温度計（SwitchBot）</div>
      </header>
      <HaccpTabs current="sensors" canManage={canManage} />
      <div className="wrap stack">
        {!ready ? (
          <section className="notice notice-strong">
            <p>
              <strong>SwitchBot の鍵がまだ設定されていません。</strong>
            </p>
            <ol className="micro" style={{ paddingLeft: "1.2em", margin: "0.4rem 0 0" }}>
              <li>SwitchBotアプリ →「プロフィール」→「設定」→「アプリバージョン」を10回タップ →「開発者向けオプション」</li>
              <li>「トークン」と「クライアントシークレット」を、Vercel の環境変数 SWITCHBOT_TOKEN・SWITCHBOT_SECRET に入れて再デプロイ</li>
              <li>各温度計の設定で「クラウドサービス」をオンにする</li>
            </ol>
          </section>
        ) : apiError ? (
          <section className="notice notice-strong">SwitchBot を読めませんでした：{apiError}</section>
        ) : null}

        {ready && !apiError ? (
          <p className="micro">いまの温度（開いた時点）。30分ごとに記録し、毎晩その日の値を衛生の記録に入れます。赤は基準外。</p>
        ) : null}

        {ready ? <AlertSwitch paused={paused} canManage={canManage} /> : null}

        {views.length > 0 ? <SensorList views={canManage ? views : views.filter((v) => v.registered)} equipment={equipment} canManage={canManage} /> : ready && !apiError ? (
          <p className="notice">温度計が見つかりません。SwitchBotアプリで温度計がハブにつながっているか、各温度計の「クラウドサービス」がオンかを確かめてください。</p>
        ) : null}

        {plan ? (
          <p className="micro">
            計画（第{plan.version}版）で「温度計で自動記録」にしている設備：
            {equipment.filter((e) => e.auto).map((e) => e.name).join("・") || "なし"}。
            ほかの設備を自動にするときは <Link href="/haccp/plan">計画</Link> で変えてオーナーが承認します。
          </p>
        ) : null}
      </div>
    </>
  );
}
