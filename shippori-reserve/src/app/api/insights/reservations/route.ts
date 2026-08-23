import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SOURCE_LABEL } from "@/lib/constants";
import type { ReservationSource, ReservationStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 予約の「集計だけ」を返す口。HPの管理ダッシュボード（shipporitei.jp/dashboard）が
 * ビルド時に読みに来る。
 *
 * ★ここは個人情報を1つも通さない。
 *   氏名・電話番号・受付番号・メモ・アレルギー・請求先……は取得すらしない。
 *   下の select に書いてある列だけが外に出る。列を足すときは、それが
 *   「誰か1人を指せる情報」になっていないかを必ず考えること。
 *   HPのダッシュボードは静的HTMLとして配信され、合言葉1つで守られているだけなので、
 *   そこへ個人情報を送る設計にしてはいけない。
 *
 *   GET /api/insights/reservations?days=28
 *   ヘッダー: x-api-key: <INSIGHTS_TOKEN>
 */

const DAY = 24 * 60 * 60 * 1000;

type Row = {
  biz_date: string;
  starts_at: string;
  created_at: string;
  party_size: number;
  source: ReservationSource;
  status: ReservationStatus;
  is_exclusive: boolean;
};

/** 何日前に予約が入ったか。仕込みと席の押さえ方を決める数字 */
function leadBucket(createdAt: string, startsAt: string): string {
  const d = (new Date(startsAt).getTime() - new Date(createdAt).getTime()) / DAY;
  if (d < 0.5) return "当日";
  if (d < 2) return "1日前";
  if (d < 3) return "2日前";
  if (d < 7) return "3〜6日前";
  if (d < 14) return "1週間前";
  if (d < 28) return "2〜3週間前";
  return "1か月以上前";
}
const LEAD_ORDER = ["当日", "1日前", "2日前", "3〜6日前", "1週間前", "2〜3週間前", "1か月以上前"];

/** 予約が生きているか（キャンセル・無断キャンセルを除く） */
const isLive = (s: ReservationStatus) => s !== "cancelled" && s !== "no_show";

function summarize(rows: Row[]) {
  const live = rows.filter((r) => isLive(r.status));
  return {
    reservations: live.length,
    guests: live.reduce((a, r) => a + r.party_size, 0),
    net: live.filter((r) => r.source === "web_form").length,
    netGuests: live.filter((r) => r.source === "web_form").reduce((a, r) => a + r.party_size, 0),
    cancelled: rows.filter((r) => r.status === "cancelled").length,
    noShow: rows.filter((r) => r.status === "no_show").length,
    exclusive: live.filter((r) => r.is_exclusive).length,
  };
}

export async function GET(request: Request) {
  const token = process.env.INSIGHTS_TOKEN;
  if (!token || request.headers.get("x-api-key") !== token) {
    return NextResponse.json({ error: "認証できません。" }, { status: 401 });
  }

  const url = new URL(request.url);
  const daysParam = Number(url.searchParams.get("days") ?? 28);
  const days = Number.isInteger(daysParam) && daysParam >= 7 && daysParam <= 180 ? daysParam : 28;

  // 営業日で切る（4時締めなので、日付そのままで扱えばよい）
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000); // JST
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const to = iso(today);
  const from = iso(new Date(today.getTime() - (days - 1) * DAY));
  const prevTo = iso(new Date(today.getTime() - days * DAY));
  const prevFrom = iso(new Date(today.getTime() - (days * 2 - 1) * DAY));

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("reservations")
    // ここに書いた列だけが外に出る。氏名・電話・メモは取らない。
    .select("biz_date, starts_at, created_at, party_size, source, status, is_exclusive")
    .gte("biz_date", prevFrom)
    .lte("biz_date", to)
    .order("biz_date");

  if (error) {
    return NextResponse.json({ error: "読み込みに失敗しました。" }, { status: 500 });
  }

  const rows = (data ?? []) as Row[];
  const cur = rows.filter((r) => r.biz_date >= from);
  const prev = rows.filter((r) => r.biz_date >= prevFrom && r.biz_date <= prevTo);
  const live = cur.filter((r) => isLive(r.status));

  // 流入元別（多い順）
  const bySourceMap = new Map<string, { count: number; guests: number }>();
  for (const r of live) {
    const e = bySourceMap.get(r.source) ?? { count: 0, guests: 0 };
    e.count++;
    e.guests += r.party_size;
    bySourceMap.set(r.source, e);
  }
  const bySource = [...bySourceMap.entries()]
    .map(([key, v]) => ({
      key,
      label: SOURCE_LABEL[key as ReservationSource] ?? key,
      count: v.count,
      guests: v.guests,
    }))
    .sort((a, b) => b.count - a.count);

  // 日別（予約が入った日ではなく、来店する日で並べる）
  const dailyMap = new Map<string, { count: number; guests: number; net: number }>();
  for (let i = 0; i < days; i++) {
    dailyMap.set(iso(new Date(today.getTime() - (days - 1 - i) * DAY)), { count: 0, guests: 0, net: 0 });
  }
  for (const r of live) {
    const e = dailyMap.get(r.biz_date);
    if (!e) continue;
    e.count++;
    e.guests += r.party_size;
    if (r.source === "web_form") e.net++;
  }
  const daily = [...dailyMap.entries()].map(([date, v]) => ({ date, ...v }));

  // 何日前に予約が入るか
  const leadMap = new Map<string, number>(LEAD_ORDER.map((k) => [k, 0]));
  for (const r of live) {
    const k = leadBucket(r.created_at, r.starts_at);
    leadMap.set(k, (leadMap.get(k) ?? 0) + 1);
  }
  const leadTime = LEAD_ORDER.map((bucket) => ({ bucket, count: leadMap.get(bucket) ?? 0 }));

  // 来店の時間帯（開始時刻・JST）
  const hourMap = new Map<number, number>();
  for (const r of live) {
    const h = new Date(new Date(r.starts_at).getTime() + 9 * 60 * 60 * 1000).getUTCHours();
    hourMap.set(h, (hourMap.get(h) ?? 0) + 1);
  }
  const byHour = [...hourMap.entries()].map(([hour, count]) => ({ hour, count })).sort((a, b) => a.hour - b.hour);

  // 曜日別
  const dowCount = Array.from({ length: 7 }, () => ({ count: 0, guests: 0 }));
  for (const r of live) {
    const w = new Date(`${r.biz_date}T00:00:00Z`).getUTCDay();
    dowCount[w].count++;
    dowCount[w].guests += r.party_size;
  }
  const byDow = dowCount.map((v, dow) => ({ dow, ...v }));

  // 人数の分け方（1〜2名／3〜4名／5〜6名／7〜8名／9名以上）
  const sizeBands = [
    { band: "1〜2名", min: 1, max: 2 },
    { band: "3〜4名", min: 3, max: 4 },
    { band: "5〜6名", min: 5, max: 6 },
    { band: "7〜8名", min: 7, max: 8 },
    { band: "9名以上", min: 9, max: 999 },
  ].map((b) => ({
    band: b.band,
    count: live.filter((r) => r.party_size >= b.min && r.party_size <= b.max).length,
  }));

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    days,
    range: { from, to },
    prevRange: { from: prevFrom, to: prevTo },
    totals: summarize(cur),
    prev: summarize(prev),
    bySource,
    daily,
    leadTime,
    byHour,
    byDow,
    partySize: sizeBands,
  });
}
