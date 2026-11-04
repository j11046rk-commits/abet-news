import { NextResponse } from "next/server";
import { apiProfile } from "@/lib/auth";
import { toCsv } from "@/lib/haccp";
import { buildReport, type ReportType } from "@/lib/haccp-report";
import { mdhm } from "@/lib/haccp-time";

const TYPES: ReportType[] = ["general", "temps", "critical", "incidents", "reviews"];

/**
 * 衛生管理の記録を CSV で書き出す（Excel でそのまま開ける UTF-8・BOM付き）。
 *   GET /api/haccp/csv?type=general&m=2026-11
 * 店長・オーナー（haccp.manage）だけ。未記録は「未記録」のまま出す。
 */
export async function GET(request: Request) {
  const auth = await apiProfile("haccp.manage");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(request.url);
  const type = url.searchParams.get("type") as ReportType;
  const m = url.searchParams.get("m") ?? "";
  if (!TYPES.includes(type) || !/^\d{4}-\d{2}$/.test(m)) {
    return NextResponse.json({ error: "type と m（YYYY-MM）を指定してください。" }, { status: 400 });
  }
  const r = await buildReport(type, m);
  const csv = toCsv([
    [r.title],
    ["店舗", r.store],
    ["対象期間", r.period],
    ["出力日", mdhm(new Date().toISOString()), "出力者", auth.me.display_name],
    [],
    r.columns,
    ...r.rows,
  ]);
  const name = `haccp-${type}-${m}.csv`;
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
