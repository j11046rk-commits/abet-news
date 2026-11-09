import { NextResponse } from "next/server";
import { pollSensors } from "@/lib/haccp-sensor-jobs";
import { verifyApiToken } from "@/lib/api-token";

/**
 * 30分ごと：温度計（SwitchBot）を読んで残し、基準外・止まり・電池の知らせを判断する。
 *
 * 呼ぶのは Supabase の定期実行（pg_cron＋pg_net・毎時7分と37分・0077）。合言葉は api_tokens の switchbot_cron
 * （DBの中で作ってハッシュだけ置き、平文は Supabase Vault にだけある）。
 * 2026-11-09 まで呼んでいた GitHub Actions は、夜間に2〜4時間とぶことがあったので移した。
 * Vercel の定期実行（Bearer CRON_SECRET）・手動（x-api-key＝INSIGHTS_TOKEN）からも呼べる。
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const cron = process.env.CRON_SECRET;
  const key = process.env.INSIGHTS_TOKEN;
  const presented = request.headers.get("x-api-key");
  const okCron = !!cron && request.headers.get("authorization") === `Bearer ${cron}`;
  const okKey = (!!key && presented === key) || (await verifyApiToken("switchbot_cron", presented));
  if (!okCron && !okKey) return NextResponse.json({ error: "認証できません。" }, { status: 401 });
  const r = await pollSensors();
  return NextResponse.json({ ok: true, ...r });
}
