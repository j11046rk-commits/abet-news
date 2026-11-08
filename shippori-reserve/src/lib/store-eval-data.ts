import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMonthLabor, getMonthlySalesTarget, getMonthSales } from "@/lib/queries";
import { hitOf, salesView } from "@/lib/sales";
import { fmtSpan, periodCost, salesExTax, stockPeriods, type Purchase, type Stocktake } from "@/lib/cost";
import type { SalesDay } from "@/lib/sales";
import { LABOR_FROM } from "@/lib/labor";
import { fmtYm, monthRange, shiftDate } from "@/lib/time";
import { laborCostFor, starsEarned, storeEval, type EvalResult, type EvalTargets } from "@/lib/store-eval";

/*
 * 店舗評価と⭐の読み出し。売上・シフト・労働時間は利用者のログイン（RLS）で読む（全員が見られる表）。
 * 原価率だけは、原価を見られない人（スタッフ）にも店舗評価として見せる（店主指定 2026-11-09「全員が見られる」）ため、
 * サーバーの管理キーで読んで「率」だけを返す。仕入の明細・在庫額は返さない。
 */

async function costRatioFor(from: string, to: string, current: boolean): Promise<{ ratio: number | null; span: string | null }> {
  const admin = createAdminClient();
  const { data: st } = await admin
    .from("cost_stocktakes")
    .select("as_of, counted_on, timing, status, total_ex")
    .gte("as_of", shiftDate(from, -120))
    .lte("as_of", to);
  const all = stockPeriods((st ?? []) as Stocktake[]);
  const inMonth = all.filter((p) => p.to >= from && p.to <= to);
  const use = inMonth.length > 0 ? inMonth : current && all.length > 0 ? [all.at(-1)!] : [];
  if (use.length === 0) return { ratio: null, span: null };
  const f = use[0]!.from;
  const t = use.at(-1)!.to;
  const [{ data: sd }, { data: pd }] = await Promise.all([
    admin.from("sales_daily").select("biz_date, target_yen, actual_yen, tax8_yen, tax10_yen").gte("biz_date", f).lte("biz_date", t),
    admin
      .from("cost_purchases")
      .select("id, book_date, vendor, doc_kind, food_ex, drink_ex, supplies_ex, other_ex, total_in, period_from, period_to, status")
      .gte("book_date", f)
      .lte("book_date", shiftDate(t, 45)),
  ]);
  const sales = new Map((sd ?? []).map((r) => [r.biz_date as string, r as SalesDay]));
  const pc = periodCost({ from: f, to: t, sales, purchases: (pd ?? []) as Purchase[], open: use[0]!.open, close: use.at(-1)!.close });
  return { ratio: pc.ratio, span: fmtSpan(f, t) };
}

/**
 * 人件費の材料：その月の合計（あれば）と、推定に使う直近の実績の月（合計と労働時間）。
 * 合計は店全体の1つの数字だけ（labor_cost_monthly）。個人の額はどこにも無い。
 */
async function laborCostInputs(ym: string): Promise<{ actual: number | null; calib: { ym: string; total: number; minutes: number } | null }> {
  const supabase = await createClient();
  const { data } = await supabase.from("labor_cost_monthly").select("ym, total_yen").lte("ym", ym).order("ym", { ascending: false }).limit(6);
  const rows = (data ?? []) as { ym: string; total_yen: number }[];
  const actual = rows.find((r) => r.ym === ym)?.total_yen ?? null;
  if (actual != null) return { actual, calib: null };
  for (const r of rows) {
    const { from, to } = monthRange(r.ym);
    // 労働時間は LABOR_FROM（外注の時間も freee に入った日）から。それより前の月は時間単価を出せない
    if (to < LABOR_FROM) continue;
    const { data: ld } = await supabase.from("labor_daily").select("work_min").gte("biz_date", from > LABOR_FROM ? from : LABOR_FROM).lte("biz_date", to);
    const minutes = (ld ?? []).reduce((a, x) => a + ((x.work_min as number) ?? 0), 0);
    if (minutes > 0) return { actual: null, calib: { ym: r.ym, total: r.total_yen, minutes } };
  }
  return { actual: null, calib: null };
}

/** 原価率：その月に終わった棚卸の区間をつないだもの。今月でまだ無ければ、いちばん新しい区間 */
export type MonthEval = EvalResult & { ym: string; current: boolean; salesNote: string };

/** その月の店舗評価。今月は「売上が入っている日まで」の目標と比べる（リアルタイム） */
export async function getMonthEval(ym: string, today: string, targets: EvalTargets): Promise<MonthEval> {
  const { from, to } = monthRange(ym);
  const current = ym === fmtYm(today);
  const [sales, monthlyTarget, labor, cost, laborCost] = await Promise.all([
    getMonthSales(ym),
    getMonthlySalesTarget(ym),
    getMonthLabor(ym),
    costRatioFor(from, to, current),
    laborCostInputs(ym),
  ]);

  let actual: number | null = null;
  let dailySum = 0;
  let lastWithActual: string | null = null;
  let laborMin = 0;
  let salesExAll: number | null = null;
  let salesExLaborDays: number | null = null;
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    const v = salesView(sales.get(d));
    if (v.target) dailySum += v.target;
    if (v.total != null) {
      actual = (actual ?? 0) + v.total;
      lastWithActual = d;
    }
    const ex = salesExTax(sales.get(d));
    if (ex != null) salesExAll = (salesExAll ?? 0) + ex;
    // 推定のときは、労働時間が取り込めた日だけで割る（取り込みが1日遅れても率がぶれないように）
    const lm = labor.get(d)?.workMin;
    if (lm != null && lm > 0 && ex != null) {
      laborMin += lm;
      salesExLaborDays = (salesExLaborDays ?? 0) + ex;
    }
  }
  let cumTarget = 0;
  if (lastWithActual) {
    for (let d = from; d <= lastWithActual; d = shiftDate(d, 1)) cumTarget += sales.get(d)?.target_yen ?? 0;
  }
  const target = current ? (cumTarget || null) : (monthlyTarget ?? (dailySum || null));
  const salesNote = current && lastWithActual ? `${Number(lastWithActual.slice(5, 7))}/${Number(lastWithActual.slice(8))}までの目標と比べています` : current ? "" : "月の目標と比べています";

  const lc = laborCostFor({ actualTotal: laborCost.actual, minutes: laborMin, calib: laborCost.calib, fallbackHourCost: targets.hourCost });
  const r = storeEval({
    sales: { actual, target },
    labor: { ...lc, salesEx: lc.estimated ? salesExLaborDays : salesExAll },
    cost,
    targets,
  });
  return { ...r, ym, current, salesNote };
}

export type StarRow = { profileId: string; earned: number; used: number; requested: number; openRequestId: string | null };

/**
 * 累計の⭐（シフトを確定した月の、達成した日×出勤）と、交換の記録。
 * 交換の記録は RLS で「本人の分」か「店長・オーナーなら全員の分」だけ返る。
 */
export async function getStarRows(): Promise<Map<string, StarRow>> {
  const supabase = await createClient();
  const { data: pubs } = await supabase.from("shift_publications").select("ym");
  const published = new Set((pubs ?? []).map((p) => p.ym as string));
  const out = new Map<string, StarRow>();
  const row = (id: string) => {
    if (!out.has(id)) out.set(id, { profileId: id, earned: 0, used: 0, requested: 0, openRequestId: null });
    return out.get(id)!;
  };
  if (published.size > 0) {
    const yms = [...published].sort();
    const from = monthRange(yms[0]!).from;
    const to = monthRange(yms.at(-1)!).to;
    const [{ data: shifts }, { data: sales }] = await Promise.all([
      supabase.from("shifts").select("biz_date, profile_id").gte("biz_date", from).lte("biz_date", to),
      supabase
        .from("sales_daily")
        .select("biz_date, target_yen, actual_yen, tax8_yen, tax10_yen, coupon_yen")
        .gte("biz_date", from)
        .lte("biz_date", to),
    ]);
    const byDate = new Map<string, string[]>();
    for (const s of shifts ?? []) byDate.set(s.biz_date as string, [...(byDate.get(s.biz_date as string) ?? []), s.profile_id as string]);
    const hits = (sales ?? []).filter((s) => hitOf(salesView(s as never))).map((s) => s.biz_date as string);
    for (const [id, n] of starsEarned(hits, byDate, published)) row(id).earned = n;
  }
  const { data: reds } = await supabase.from("star_redemptions").select("id, profile_id, stars, status");
  for (const r of reds ?? []) {
    const x = row(r.profile_id as string);
    if (r.status === "done") x.used += r.stars as number;
    if (r.status === "requested") {
      x.requested += r.stars as number;
      x.openRequestId = r.id as string;
    }
  }
  return out;
}

export type StarRequest = { id: string; profileId: string; stars: number; requestedAt: string };

/** 申請中の交換（店長・オーナーが見る） */
export async function getOpenStarRequests(): Promise<StarRequest[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("star_redemptions")
    .select("id, profile_id, stars, requested_at")
    .eq("status", "requested")
    .order("requested_at");
  return (data ?? []).map((r) => ({ id: r.id as string, profileId: r.profile_id as string, stars: r.stars as number, requestedAt: r.requested_at as string }));
}
