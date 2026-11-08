import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { planForDate } from "@/lib/haccp";
import { getPlans } from "@/lib/haccp-data";
import { listThermometers, readStatus, switchbotReady, type SbDevice } from "@/lib/switchbot";
import { todayBizDate } from "@/lib/time";
import HaccpTabs from "../HaccpTabs";
import SensorList, { type SensorView } from "./SensorList";

export const dynamic = "force-dynamic";

/**
 * 温度計（SwitchBot）と冷蔵庫・冷凍庫の結びつけ（店長・オーナー・0068）。
 * 一覧と「いまの温度」は SwitchBot から直接読む（開いたときだけ）。
 */
export default async function SensorsPage() {
  await requirePermission("haccp.manage");
  const today = todayBizDate();
  const plans = await getPlans();
  const plan = planForDate(plans, today);
  const equipment = (plan?.content.equipment ?? []).map((e) => ({ id: e.id, name: e.name, auto: !!e.auto }));

  const supabase = await createClient();
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

  return (
    <>
      <header className="appbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-face-96.png" alt="しっぽり亭" width={96} height={96} className="appbar__logo" />
        <div className="appbar__title">温度計（SwitchBot）</div>
      </header>
      <HaccpTabs current="sensors" canManage />
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
          <p className="micro">
            温度計ごとに、どの冷蔵庫・冷凍庫に置いたかを選んでください。選んだ温度計は30分ごとに読み、毎晩その日の値を衛生管理の記録に入れます。
            グラス用・瓶ビール用など計画に無い冷蔵庫は「参考に見るだけ」（記録はしない・電池切れだけ知らせる）。
          </p>
        ) : null}

        {views.length > 0 ? <SensorList views={views} equipment={equipment} /> : ready && !apiError ? (
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
