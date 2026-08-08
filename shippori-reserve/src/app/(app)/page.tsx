import Link from "next/link";
import { ModeBadge } from "@/components/Badges";
import ReservationCard from "@/components/ReservationCard";
import { attentionReason } from "@/lib/attention";
import { ACTIVE_STATUSES, TOTAL_SEATS } from "@/lib/constants";
import { getDailySummary, getReservationsByDate } from "@/lib/queries";
import { fmtDateShort, shiftDate, startLabel, todayBizDate } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * S2「今日」— 第一画面。
 * 開いた瞬間に「今日どうなっているか」が分かること。スクロールなしで
 * ①サマリー ②時系列 ③＋予約を登録 の3つが見える。
 */
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.d ?? "") ? sp.d! : todayBizDate();

  const [summary, reservations] = await Promise.all([
    getDailySummary(date),
    getReservationsByDate(date),
  ]);

  const active = reservations.filter((r) => ACTIVE_STATUSES.includes(r.status));
  const flagged = reservations
    .map((r) => ({ r, reason: attentionReason(r, summary.mode) }))
    .filter((x) => x.reason);

  const isEvent = summary.mode === "event";

  return (
    <>
      <header className="appbar">
        <div>
          <div className="appbar__title">
            {fmtDateShort(date)} {isEvent ? "イベント営業" : "通常営業"}
          </div>
          <div className="appbar__sub">
            {date === todayBizDate() ? "今日" : "この日の予約"}
          </div>
        </div>
        <div className="appbar__spacer" />
        <Link className="btn btn-sm" href={`/?d=${shiftDate(date, -1)}`} aria-label="前の日">
          ‹
        </Link>
        <Link className="btn btn-sm" href="/">
          今日
        </Link>
        <Link className="btn btn-sm" href={`/?d=${shiftDate(date, 1)}`} aria-label="次の日">
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

        {/* ① サマリー ─ イベント営業日は席ではなく定員で見る */}
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
              <span className="summary__num">
                {summary.remaining_capacity ?? "—"}
              </span>
              <span className="summary__label">残り定員（{summary.event_capacity}名）</span>
            </div>
          ) : (
            <div className="summary__item">
              <span className="summary__num">
                {summary.guest_count}
                <span style={{ fontSize: "0.9rem", color: "var(--text-dim)" }}>
                  /{TOTAL_SEATS}
                </span>
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

        {/* 要対応 ─ 先頭に立てる。本体は下の時系列にあるので、ここは行き先の案内だけ。 */}
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

        {/* ② 時系列 */}
        <section className="list">
          {reservations.length === 0 ? (
            <p className="empty">
              {summary.is_closed
                ? "この日は休業日です。"
                : "この日の予約はまだありません。"}
            </p>
          ) : (
            reservations.map((r) => (
              <ReservationCard
                key={r.id}
                reservation={r}
                attention={attentionReason(r, summary.mode)}
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

      {/* ③ どこにいても親指の位置にある */}
      <Link className="fab" href={`/reservations/new?d=${date}`}>
        ＋ 予約を登録
      </Link>
    </>
  );
}
