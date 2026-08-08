import Link from "next/link";
import DateJa from "@/components/DateJa";
import ReservationCard from "@/components/ReservationCard";
import SearchControls from "@/components/SearchControls";
import { requirePermission } from "@/lib/auth";
import { ACTIVE_STATUSES } from "@/lib/constants";
import { getProfileNames, searchReservations } from "@/lib/queries";
import { shiftDate, shiftMonth, todayBizDate } from "@/lib/time";
import type { Reservation } from "@/lib/types";

export const dynamic = "force-dynamic";

type Search = {
  period?: string;
  from?: string;
  to?: string;
  status?: string;
  source?: string;
  q?: string;
  order?: string;
};

/** 期間チップ → 実際の日付範囲。「先週LINEで来た鈴木さん」に辿り着ければよい。 */
function resolvePeriod(sp: Search): { from?: string; to?: string } {
  const today = todayBizDate();
  switch (sp.period) {
    case "today":
      return { from: today, to: today };
    case "week":
      return { from: today, to: shiftDate(today, 6) };
    case "month":
      return { from: shiftMonth(today, 0), to: shiftDate(shiftMonth(today, 1), -1) };
    case "past":
      return { from: shiftDate(today, -90), to: shiftDate(today, -1) };
    case "all":
      return {};
    default:
      return { from: sp.from || undefined, to: sp.to || undefined };
  }
}

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requirePermission("reservation.read");
  const sp = await searchParams;

  const range = resolvePeriod(sp);
  const desc = sp.order === "desc" || sp.period === "past";

  const [rows, names] = await Promise.all([
    searchReservations({
      ...range,
      status: sp.status || undefined,
      source: sp.source || undefined,
      q: sp.q || undefined,
      desc,
    }),
    getProfileNames(),
  ]);

  // 日付でまとめる。DBから既に日付順で来ているので順序はそのまま。
  const groups: { date: string; items: Reservation[] }[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === r.biz_date) last.items.push(r);
    else groups.push({ date: r.biz_date, items: [r] });
  }

  const activeRows = rows.filter((r) => ACTIVE_STATUSES.includes(r.status));
  const guests = activeRows.reduce((sum, r) => sum + r.party_size, 0);

  return (
    <>
      <header className="appbar">
        <div className="appbar__title">予約一覧</div>
        <div className="appbar__spacer" />
        <span className="appbar__sub">
          {rows.length}件 / {guests}名
        </span>
      </header>

      <div className="wrap">
        <SearchControls />

        {groups.length === 0 ? (
          <p className="empty">該当する予約はありません。</p>
        ) : (
          groups.map((g) => (
            <section key={g.date} className="daygroup">
              <div className="daygroup__head">
                <span className="daygroup__date">
                  <DateJa date={g.date} long />
                </span>
                <Link className="micro" href={`/day/${g.date}`}>
                  この日を開く ›
                </Link>
              </div>
              <div className="list">
                {g.items.map((r) => (
                  <ReservationCard
                    key={r.id}
                    reservation={r}
                    registrar={r.created_by ? (names.get(r.created_by) ?? null) : null}
                  />
                ))}
              </div>
            </section>
          ))
        )}

        <div style={{ height: "3.5rem" }} />
      </div>

      <Link className="fab" href="/reservations/new">
        ＋ 予約を登録
      </Link>
    </>
  );
}
