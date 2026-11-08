import { NextResponse } from "next/server";
import { autoRecord, pollSensors } from "@/lib/haccp-sensor-jobs";

/**
 * 毎晩（日本時間 1:40ごろ・営業日の終わり）：温度計の設備ぶんの衛生管理の記録を自動で書く。
 * 書く前にもう一度だけ温度計を読む（30分ごとの読み取りが止まっていても、その日の値が最低1つは残るように）。
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "認証できません。" }, { status: 401 });
  }
  const poll = await pollSensors();
  const rec = await autoRecord();
  return NextResponse.json({ ok: true, poll, rec });
}
