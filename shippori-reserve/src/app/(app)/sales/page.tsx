import Link from "next/link";
import SalesBoard, { type SalesBoardDay } from "@/components/SalesBoard";
import { requireProfile } from "@/lib/auth";
import { can } from "@/lib/constants";
import { isHoliday } from "@/lib/holidays";
import {
  deriveBusinessDay,
  getAllProfiles,
  getMonthlySalesTarget,
  getMonthSales,
  getMonthShifts,
  getMonthSummaries,
  getSettings,
  getShiftPublication,
} from "@/lib/queries";
import { hitOf, salesView } from "@/lib/sales";
import { surname } from "@/lib/staff";
import {
  fmtMonthJa,
  fmtYm,
  monthRange,
  shiftDate,
  shiftMonth,
  todayBizDate,
  WEEKDAY_JA,
  weekdayOf,
} from "@/lib/time";

export const dynamic = "force-dynamic";

const YM_RE = /^\d{4}-\d{2}$/;

/**
 * 売上タブ。日毎の目標と実績をグラフで見る（全員が見られる・店主指定）。
 * 実績はエアレジ→週次レポート経由の取り込み。目標は営業日の設定から入力。
 *
 * 物差しが2つある（店主指示 2026-08）。日毎の数字と達成判定は店内の売上だけ、
 * 月間の合計と目標の達成は物販込みの合計。物販は別枠のカードに出す。
 */
export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const me = await requireProfile();
  const sp = await searchParams;
  const today = todayBizDate();
  const ym = YM_RE.test(sp.m ?? "") ? sp.m! : fmtYm(today);

  const [sales, monthlyTarget, summaries, settings, shiftMap, shiftsPublishedAt, profiles] =
    await Promise.all([
      getMonthSales(ym),
      getMonthlySalesTarget(ym),
      getMonthSummaries(ym),
      getSettings(),
      getMonthShifts(ym),
      getShiftPublication(ym),
      getAllProfiles(),
    ]);

  const { from, to } = monthRange(ym);
  const days: SalesBoardDay[] = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    const dow = weekdayOf(d);
    // 店内・物販・合計への読み替えは lib/sales.ts の1か所だけで行う
    const v = salesView(sales.get(d));
    days.push({
      date: d,
      day: Number(d.slice(8)),
      dow,
      dowLabel: WEEKDAY_JA[dow],
      holiday: isHoliday(d),
      closed: summaries.get(d)?.is_closed ?? deriveBusinessDay(d, settings).is_closed,
      target: v.target,
      dineIn: v.dineIn,
      retail: v.retail,
      total: v.total,
      isToday: d === today,
    });
  }

  // 達成貢献⭐：達成した日に出勤していた人に星（確定シフト×達成日・店主承認の案C）
  // 達成の定義はグリッドの金色セル・連続達成と同じ hitOf（＝店内の売上だけで見る）。
  const shiftEligible = profiles
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.is_active && p.role !== "owner" && p.role !== "viewer");
  const stars = new Map<string, number>(shiftEligible.map(({ p }) => [p.id, 0]));
  if (shiftsPublishedAt) {
    for (const d of days) {
      if (!hitOf(d)) continue;
      for (const id of shiftMap.get(d.date) ?? []) {
        if (stars.has(id)) stars.set(id, (stars.get(id) ?? 0) + 1);
      }
    }
  }
  const contrib = shiftEligible
    .map(({ p, i }) => ({ id: p.id, name: surname(p.display_name), colorIndex: i, stars: stars.get(p.id) ?? 0 }))
    .sort((a, b) => b.stars - a.stars);

  return (
    <>
      <header className="appbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-face.png" alt="しっぽり亭" className="appbar__logo" />
        <Link className="btn btn-sm" href={`/sales?m=${fmtYm(shiftMonth(`${ym}-01`, -1))}`} aria-label="前の月">
          ‹
        </Link>
        <div>
          <div className="appbar__title">{fmtMonthJa(`${ym}-01`)} 売上</div>
          <div className="appbar__sub">目標と実績</div>
        </div>
        <Link className="btn btn-sm" href={`/sales?m=${fmtYm(shiftMonth(`${ym}-01`, 1))}`} aria-label="次の月">
          ›
        </Link>
      </header>

      <div className="wrap stack">
        <SalesBoard
          key={ym}
          days={days}
          today={today}
          monthlyTarget={monthlyTarget}
          contrib={contrib}
          shiftsPublished={!!shiftsPublishedAt}
        />

        {can(me.role, "sales.write") ? (
          <p className="micro" style={{ textAlign: "center" }}>
            目標・実績の手入力は カレンダー → 日付 → <strong>営業日の設定</strong> から。
            実績はエアレジ（週次レポート）から自動で取り込めます。
            物販（お持ち帰り）があった日も、同じ画面から入れられます。
          </p>
        ) : null}

        <div style={{ height: "2rem" }} />
      </div>
    </>
  );
}
