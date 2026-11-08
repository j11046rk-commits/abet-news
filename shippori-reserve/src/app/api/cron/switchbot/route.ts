import { NextResponse } from "next/server";
import { pollSensors } from "@/lib/haccp-sensor-jobs";

/**
 * 30分ごと：温度計（SwitchBot）を読んで残し、基準外・止まり・電池の知らせを判断する。
 * 呼ぶのは GitHub Actions（.github/workflows/switchbot-poll.yml・x-api-key＝INSIGHTS_TOKEN）。
 * Vercel の定期実行（Bearer CRON_SECRET）からも呼べる。
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const cron = process.env.CRON_SECRET;
  const key = process.env.INSIGHTS_TOKEN;
  const okCron = !!cron && request.headers.get("authorization") === `Bearer ${cron}`;
  const okKey = !!key && request.headers.get("x-api-key") === key;
  if (!okCron && !okKey) return NextResponse.json({ error: "認証できません。" }, { status: 401 });
  const r = await pollSensors();
  return NextResponse.json({ ok: true, ...r });
}
