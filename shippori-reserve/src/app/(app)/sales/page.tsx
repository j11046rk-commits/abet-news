import Link from "next/link";
import SalesBoard, { type SalesBoardDay } from "@/components/SalesBoard";
import { requireProfile } from "@/lib/auth";
import { can } from "@/lib/constants";
import { isHoliday } from "@/lib/holidays";
import { deriveBusinessDay, getMonthSales, getMonthSummaries, getSettings } from "@/lib/queries";
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

  const [sales, summaries, settings] = await Promise.all([
    getMonthSales(ym),
    getMonthSummaries(ym),
    getSettings(),
  ]);

  const { from, to } = monthRange(ym);
  const days: SalesBoardDay[] = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    const dow = weekdayOf(d);
    const s = sales.get(d);
    days.push({
      date: d,
      day: Number(d.slice(8)),
      dow,
      dowLabel: WEEKDAY_JA[dow],
      holiday: isHoliday(d),
      closed: summaries.get(d)?.is_closed ?? deriveBusinessDay(d, settings).is_closed,
      target: s?.target_yen ?? null,
      actual: s?.actual_yen ?? null,
      isToday: d === today,
    });
  }

  return (
    <>
      <header className="appbar">
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
        <div className="appbar__spacer" />
        <Link className="btn btn-sm" href="/sales">
          今月
        </Link>
      </header>

      <div className="wrap stack">
        <SalesBoard key={ym} days={days} />

        {can(me.role, "sales.write") ? (
          <p className="micro" style={{ textAlign: "center" }}>
            目標・実績の手入力は カレンダー → 日付 → <strong>営業日の設定</strong> から。
            実績はエアレジ（週次レポート）から自動で取り込めます。
          </p>
        ) : null}

        <div style={{ height: "2rem" }} />
      </div>
    </>
  );
}
