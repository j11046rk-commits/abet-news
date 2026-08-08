import Link from "next/link";
import { notFound } from "next/navigation";
import { ModeBadge } from "@/components/Badges";
import ReservationCard from "@/components/ReservationCard";
import ShiftEditor from "@/components/ShiftEditor";
import { attentionReason } from "@/lib/attention";
import { requireProfile } from "@/lib/auth";
import { ACTIVE_STATUSES, can, TOTAL_SEATS } from "@/lib/constants";
import { surname } from "@/lib/staff";
import {
  getAllProfiles,
  getDailySummary,
  getReservationsByDate,
  getShiftProfileIds,
} from "@/lib/queries";
import { fmtDateShort, shiftDate, startLabel, todayBizDate } from "@/lib/time";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 日別画面。暦で日付をタップすると開く。
 * 当日の時系列・来店/会計の1タップ・シフトの確認と編集はここ。
 */
export default async function DayPage({ params }: { params: Promise<{ date: string }> }) {
  const me = await requireProfile();
  const { date } = await params;
  if (!DATE_RE.test(date)) notFound();

  const [summary, reservations, shiftIds, profiles] = await Promise.all([
    getDailySummary(date),
    getReservationsByDate(date),
    getShiftProfileIds(date),
    getAllProfiles(),
  ]);

  const names = new Map(profiles.map((p) => [p.id, p.display_name]));
  const staff = profiles
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.is_active)
    .map(({ p, i }) => ({
      id: p.id,
      name: surname(p.display_name),
      colorIndex: i,
      on: shiftIds.includes(p.id),
    }));

  const flagged = reservations
    .map((r) => ({ r, reason: attentionReason(r, summary.mode) }))
    .filter((x) => x.reason);
  const active = reservations.filter((r) => ACTIVE_STATUSES.includes(r.status));
  const isEvent = summary.mode === "event";

  return (
    <>
      <header className="appbar">
        <Link className="btn btn-sm" href={`/?m=${date.slice(0, 7)}`}>
          ‹ 暦
        </Link>
        <div>
          <div className="appbar__title">
            {fmtDateShort(date)} {isEvent ? "イベント営業" : "通常営業"}
          </div>
          <div className="appbar__sub">{date === todayBizDate() ? "今日" : "この日の予約"}</div>
        </div>
        <div className="appbar__spacer" />
        <Link className="btn btn-sm" href={`/day/${shiftDate(date, -1)}`} aria-label="前の日">
          ‹
        </Link>
        <Link className="btn btn-sm" href={`/day/${shiftDate(date, 1)}`} aria-label="次の日">
          ›
        </Link>
      </header>

      <div className="wrap stack">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <ModeBadge
            mode={summary.mode}
            isBusy={summary.is_busy}
            isClosed={summary.is_closed}
            eventName={summary.event_name}
          />
          <Link className="micro" href={`/calendar/${date}`}>
            営業日の設定 ›
          </Link>
        </div>

        <section className="summary">
          <div className="summary__item">
            <span className="summary__num">{summary.reservation_count}</span>
            <span className="summary__label">予約</span>
          </div>
          <div className="summary__item">
            <span className="summary__num">{summary.guest_count}</span>
            <span className="summary__label">名</span>
          </div>
          {isEvent ? (
            <div className="summary__item">
              <span className="summary__num">{summary.remaining_capacity ?? "—"}</span>
              <span className="summary__label">残り定員（{summary.event_capacity}名）</span>
            </div>
          ) : (
            <div className="summary__item">
              <span className="summary__num">
                {summary.guest_count}
                <span style={{ fontSize: "0.9rem", color: "var(--text-dim)" }}>/{TOTAL_SEATS}</span>
              </span>
              <span className="summary__label">席</span>
            </div>
          )}
          {summary.tentative_count > 0 ? (
            <div className="summary__item">
              <span className="summary__num" style={{ color: "var(--seal)" }}>
                {summary.tentative_count}
              </span>
              <span className="summary__label">仮予約</span>
            </div>
          ) : null}
        </section>

        <ShiftEditor date={date} staff={staff} canEdit={can(me.role, "shift.write")} />

        {flagged.length > 0 ? (
          <section className="card card--flag">
            <p className="micro" style={{ color: "var(--seal)", letterSpacing: "0.1em" }}>
              要対応 {flagged.length}件
            </p>
            <ul style={{ margin: "0.4rem 0 0", padding: 0, listStyle: "none" }}>
              {flagged.map(({ r, reason }) => (
                <li key={r.id} style={{ padding: "0.15rem 0" }}>
                  <Link href={`/reservations/${r.id}`} style={{ color: "inherit" }}>
                    <span className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {startLabel(r)}
                    </span>{" "}
                    {r.customer_name} 様{" "}
                    <span className="micro" style={{ color: "var(--seal)" }}>
                      {reason}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="list">
          {reservations.length === 0 ? (
            <p className="empty">
              {summary.is_closed ? "この日は休業日です。" : "この日の予約はまだありません。"}
            </p>
          ) : (
            reservations.map((r) => (
              <ReservationCard
                key={r.id}
                reservation={r}
                attention={attentionReason(r, summary.mode)}
                registrar={r.created_by ? (names.get(r.created_by) ?? null) : null}
              />
            ))
          )}
        </section>

        {active.length > 0 ? (
          <p className="micro" style={{ textAlign: "center" }}>
            キャンセル・無断キャンセルを除いて {active.length} 件
          </p>
        ) : null}

        <div style={{ height: "3.5rem" }} />
      </div>

      <Link className="fab" href={`/reservations/new?d=${date}`}>
        ＋ 予約を登録
      </Link>
    </>
  );
}
