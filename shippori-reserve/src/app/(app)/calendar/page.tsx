import Link from "next/link";
import CalendarGrid from "@/components/CalendarGrid";
import { requirePermission } from "@/lib/auth";
import { getMonthSummaries, getSettings, deriveBusinessDay } from "@/lib/queries";
import { fmtMonthJa, fmtYm, monthGrid, shiftMonth, todayBizDate } from "@/lib/time";
import type { DailySummary } from "@/lib/types";

export const dynamic = "force-dynamic";

const YM_RE = /^\d{4}-\d{2}$/;

/** S6 カレンダー。月を俯瞰して、営業モードと繁忙日を管理する。 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const me = await requirePermission("reservation.read");
  const sp = await searchParams;
  const ym = YM_RE.test(sp.m ?? "") ? sp.m! : fmtYm(todayBizDate());

  const [saved, settings] = await Promise.all([getMonthSummaries(ym), getSettings()]);
  const dates = monthGrid(ym);

  // 行が無い日も曜日から組み立てて、月の姿がそろって見えるようにする
  const days: DailySummary[] = dates.map((d) => {
    const hit = saved.get(d);
    if (hit) return hit;
    return {
      ...deriveBusinessDay(d, settings),
      reservation_count: 0,
      guest_count: 0,
      tentative_count: 0,
      cancelled_count: 0,
      no_show_count: 0,
      remaining_capacity: null,
    };
  });

  const inMonth = days.filter((d) => d.biz_date.startsWith(ym));
  const totalReservations = inMonth.reduce((n, d) => n + d.reservation_count, 0);
  const totalGuests = inMonth.reduce((n, d) => n + d.guest_count, 0);
  const eventDays = inMonth.filter((d) => d.mode === "event").length;

  return (
    <>
      <header className="appbar">
        <Link className="btn btn-sm" href={`/calendar?m=${fmtYm(shiftMonth(`${ym}-01`, -1))}`}>
          ‹
        </Link>
        <div className="appbar__title">{fmtMonthJa(`${ym}-01`)}</div>
        <Link className="btn btn-sm" href={`/calendar?m=${fmtYm(shiftMonth(`${ym}-01`, 1))}`}>
          ›
        </Link>
        <div className="appbar__spacer" />
        <Link className="btn btn-sm" href="/calendar">
          今月
        </Link>
      </header>

      <div className="wrap stack">
        <CalendarGrid ym={ym} days={days} canEdit={me.role !== "viewer"} />

        <section className="summary">
          <div className="summary__item">
            <span className="summary__num">{totalReservations}</span>
            <span className="summary__label">今月の予約</span>
          </div>
          <div className="summary__item">
            <span className="summary__num">{totalGuests}</span>
            <span className="summary__label">名</span>
          </div>
          <div className="summary__item">
            <span className="summary__num">{eventDays}</span>
            <span className="summary__label">イベント営業日</span>
          </div>
        </section>

        <p className="micro">
          日付をタップすると営業日の設定（通常／イベント・定員・繁忙日・休業）を開きます。
          長押しで繁忙日のON/OFFだけを切り替えられます。
        </p>

        <div style={{ height: "2rem" }} />
      </div>
    </>
  );
}
