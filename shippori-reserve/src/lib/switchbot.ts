import "server-only";
import { createHmac, randomUUID } from "node:crypto";

/**
 * SwitchBot クラウドAPI（v1.1）。温度計の一覧と、いまの温度・湿度・電池を読むだけ（操作はしない）。
 * 鍵は Vercel の環境変数 SWITCHBOT_TOKEN / SWITCHBOT_SECRET（SwitchBotアプリ → 開発者向けオプション）。
 * 署名：sign = base64(HMAC-SHA256(secret, token + t + nonce))（公式の手順・JavaScript例のとおり）
 *
 * 温度計は各端末の設定で「クラウドサービス」をオンにしておかないと一覧に出ない・値が読めない。
 */

const BASE = process.env.SWITCHBOT_BASE_URL || "https://api.switch-bot.com";
const TIMEOUT_MS = 10_000;

/** 温度を返す機種（温湿度計・防水温湿度計・ハブ2 など） */
const THERMO_TYPES = /meter|woiosensor|hub 2|hub2|thermo/i;

export const switchbotReady = () => !!process.env.SWITCHBOT_TOKEN && !!process.env.SWITCHBOT_SECRET;

function headers(): Record<string, string> {
  const token = process.env.SWITCHBOT_TOKEN!;
  const secret = process.env.SWITCHBOT_SECRET!;
  const t = String(Date.now());
  const nonce = randomUUID();
  const sign = createHmac("sha256", secret).update(token + t + nonce, "utf8").digest("base64");
  return { Authorization: token, sign, nonce, t, "Content-Type": "application/json" };
}

async function call<T>(path: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { headers: headers(), signal: ctrl.signal, cache: "no-store" });
    if (res.status === 401) throw new Error("SwitchBotの鍵（トークン・シークレット）が違います");
    const json = (await res.json().catch(() => null)) as { statusCode?: number; message?: string; body?: T } | null;
    if (!res.ok || !json || json.statusCode !== 100) {
      throw new Error(`SwitchBot ${res.status} ${json?.statusCode ?? ""} ${json?.message ?? ""}`.trim());
    }
    return json.body as T;
  } finally {
    clearTimeout(timer);
  }
}

export type SbDevice = { deviceId: string; deviceName: string; deviceType: string; enableCloudService?: boolean };
export type SbStatus = { temperature: number; humidity: number | null; battery: number | null };

/** 温度が読める端末だけ */
export async function listThermometers(): Promise<SbDevice[]> {
  const body = await call<{ deviceList?: SbDevice[] }>("/v1.1/devices");
  return (body.deviceList ?? []).filter((d) => THERMO_TYPES.test(d.deviceType ?? ""));
}

export async function readStatus(deviceId: string): Promise<SbStatus> {
  if (!/^[A-Za-z0-9:_-]{4,64}$/.test(deviceId)) throw new Error("端末IDが不正です");
  const b = await call<{ temperature?: number; humidity?: number; battery?: number }>(`/v1.1/devices/${encodeURIComponent(deviceId)}/status`);
  if (typeof b.temperature !== "number" || !Number.isFinite(b.temperature)) throw new Error("温度が返ってきませんでした");
  return {
    temperature: Math.round(b.temperature * 10) / 10,
    humidity: typeof b.humidity === "number" ? Math.round(b.humidity) : null,
    battery: typeof b.battery === "number" ? Math.round(b.battery) : null,
  };
}
