import AutoRefresh from "@/components/AutoRefresh";
import Link from "next/link";
import DateJa from "@/components/DateJa";
import ReservationCard from "@/components/ReservationCard";
import SearchControls from "@/components/SearchControls";
import { requirePermission } from "@/lib/auth";
import { ACTIVE_STATUSES } from "@/lib/constants";
import { getAllProfiles, searchReservations } from "@/lib/queries";
import { fmtMonthJa, fmtYm, monthRange, shiftMonth, todayBizDate } from "@/lib/time";
import type { Reservation } from "@/lib/types";

export const dynamic = "force-dynamic";

const YM_RE = /^\d{4}-\d{2}$/;

type Search = {
  m?: string;
  source?: string;
  staff?: string;
  q?: string;
};

/**
 * 予約一覧。月固定で ‹ › で月を切り替える（店主指定）。
 * 流入元・担当（受付した人）・フリーワードで絞れる。
 */
export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requirePermission("reservation.read");
  const sp = await searchParams;

  const ym = YM_RE.test(sp.m ?? "") ? sp.m! : fmtYm(todayBizDate());
  const { from, to } = monthRange(ym);

  const [rows, profiles] = await Promise.all([
    searchReservations({
      from,
      to,
      source: sp.source || undefined,
      createdBy: sp.staff || undefined,
      q: sp.q || undefined,
    }),
    getAllProfiles(),
  ]);

  const names = new Map(profiles.map((p) => [p.id, p.display_name]));
  const staffOptions = profiles
    .filter((p) => p.is_active && p.role !== "viewer")
    .map((p) => ({ id: p.id, name: p.display_name }));

  // 日付でまとめる。DBから既に日付順で来ているので順序はそのまま。
  const groups: { date: string; items: Reservation[] }[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === r.biz_date) last.items.push(r);
    else groups.push({ date: r.biz_date, items: [r] });
  }

  const activeRows = rows.filter((r) => ACTIVE_STATUSES.includes(r.status));
  const guests = activeRows.reduce((sum, r) => sum + r.party_size, 0);

  /** 月を移動しても、いまの絞り込み（流入元・担当・語句）は保つ */
  const monthHref = (n: number): string => {
    const q = new URLSearchParams();
    q.set("m", fmtYm(shiftMonth(`${ym}-01`, n)));
    if (sp.source) q.set("source", sp.source);
    if (sp.staff) q.set("staff", sp.staff);
    if (sp.q) q.set("q", sp.q);
    return `/reservations?${q.toString()}`;
  };

  return (
    <>
      <AutoRefresh />
      <header className="appbar">
        <Link className="btn btn-sm" href="/">
          ‹ カレンダー
        </Link>
        <Link className="btn btn-sm" href={monthHref(-1)} aria-label="前の月">
          ‹
        </Link>
        <div>
          <div className="appbar__title">{fmtMonthJa(`${ym}-01`)} 予約</div>
          <div className="appbar__sub">
            {rows.length}件 / {guests}名
          </div>
        </div>
        <Link className="btn btn-sm" href={monthHref(1)} aria-label="次の月">
          ›
        </Link>
      </header>

      <div className="wrap">
        <SearchControls staffOptions={staffOptions} />

        {groups.length === 0 ? (
          <p className="empty">この月の該当する予約はありません。</p>
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
