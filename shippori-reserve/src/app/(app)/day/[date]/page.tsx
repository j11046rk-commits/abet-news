import AutoRefresh from "@/components/AutoRefresh";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ModeBadge } from "@/components/Badges";
import DateJa from "@/components/DateJa";
import DayShiftEditor from "@/components/DayShiftEditor";
import ReservationCard from "@/components/ReservationCard";
import { attentionReason } from "@/lib/attention";
import { requireProfile } from "@/lib/auth";
import { ACTIVE_STATUSES, TOTAL_SEATS, can } from "@/lib/constants";
import { chipColors, surname } from "@/lib/staff";
import {
  getAllProfiles,
  getCourses,
  getDailySummary,
  getDayWeather,
  getReservationsByDate,
  getDayShiftRows,
  getShiftPublication,
} from "@/lib/queries";
import { WEATHER_ICON, WEATHER_JA } from "@/lib/weather";
import { holidayName } from "@/lib/holidays";
import { closeMinOf, resolveShiftTime, shiftTimeLabel } from "@/lib/shift-time";
import ShiftTimeBar, { type ShiftBarEntry } from "@/components/ShiftTimeBar";
import { shiftDate, startLabel, todayBizDate } from "@/lib/time";

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

  const [summary, reservations, dayShifts, shiftsPublishedAt, profiles, courses, wx] =
    await Promise.all([
      getDailySummary(date),
      getReservationsByDate(date),
      getDayShiftRows(date),
      getShiftPublication(date.slice(0, 7)),
      getAllProfiles(),
      getCourses(),
      getDayWeather(date),
    ]);
  const shiftIdsRaw = dayShifts.ids;

  // シフトは店長が「確定」した月だけ表示する。
  // 休業日も出さない（確定後に臨時休業にすると、その日のシフトの行だけが残るため）。
  const shiftIds = shiftsPublishedAt && !summary.is_closed ? shiftIdsRaw : [];

  const names = new Map(profiles.map((p) => [p.id, p.display_name]));
  const courseNames = new Map(courses.map((c) => [c.id, c.name]));
  const defOf = (p: (typeof profiles)[number]) => ({
    default_start_min: p.default_start_min ?? null,
    default_end_min: p.default_end_min ?? null,
  });
  const onShift = profiles
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => shiftIds.includes(p.id))
    .map(({ p, i }) => ({
      id: p.id,
      name: surname(p.display_name),
      colorIndex: i,
      def: defOf(p),
    }));

  // 店長・オーナーは、確定済みの日ならここで直せる（急な休み・交代）
  const canEditShift = can(me.role, "shift.write") && !!shiftsPublishedAt && !summary.is_closed;
  const shiftStaff = profiles
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.is_active && p.role !== "owner" && p.role !== "viewer")
    .map(({ p, i }) => ({
      id: p.id,
      name: surname(p.display_name),
      colorIndex: i,
      def: defOf(p),
    }));

  const flagged = reservations
    .map((r) => ({ r, reason: attentionReason(r) }))
    .filter((x) => x.reason);

  /*
   * シフトの時間帯バー（17:00〜25:00・店主要望）。
   * 「誰が居るか」の名前の並びだけでは、何時に何人いるかが読めない。
   * 時間を持たない人（店長・オーナー）は通し扱いで帯に出す。
   */
  const dayCloseMin = closeMinOf(date, summary);
  const shiftBarEntries: ShiftBarEntry[] = onShift.map((p) => {
    const t = resolveShiftTime(dayShifts.times[p.id] ?? null, p.def);
    if (!t) return { name: p.name, colorIndex: p.colorIndex, start: 17 * 60, end: 25 * 60, wholeDay: true };
    return { name: p.name, colorIndex: p.colorIndex, start: t.start, end: t.end ?? dayCloseMin };
  });
  const active = reservations.filter((r) => ACTIVE_STATUSES.includes(r.status));
  // 「席」の埋まりは、いま席を持っている予約だけで数える。
  // 会計済は席を返した（その晩もう一度売れる）ので、ここに入れると
  // 実際より埋まって見え、電話予約を断る判断を誤らせる。
  const holdingGuests = reservations
    .filter((r) => r.status === "tentative" || r.status === "confirmed" || r.status === "seated")
    .reduce((a, r) => a + r.party_size, 0);
  const isEvent = summary.mode === "event";
  const holiday = holidayName(date);

  return (
    <>
      <AutoRefresh />
      <header className="appbar">
        <Link className="btn btn-sm" href={`/?m=${date.slice(0, 7)}`}>
          ‹ カレンダー
        </Link>
        <div>
          <div className="appbar__title">
            <DateJa date={date} /> {isEvent ? "イベント営業" : "通常営業"}
          </div>
          <div className="appbar__sub">
            {/* その日の天気（実測・気象庁の新居浜アメダス）。過ぎた日にだけ付く */}
            {wx
              ? `${WEATHER_ICON[wx.weather]}${WEATHER_JA[wx.weather]}${
                  wx.temp_max_c != null ? ` ${wx.temp_max_c}°` : ""
                }・`
              : ""}
            {holiday ? `${holiday}・` : ""}
            {date === todayBizDate() ? "今日" : "この日の予約"}
          </div>
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
                {holdingGuests}
                <span style={{ fontSize: "0.9rem", color: "var(--text-dim)" }}>/{TOTAL_SEATS}</span>
              </span>
              <span className="summary__label">席</span>
            </div>
          )}
        </section>

        <section className="card">
          <div className="row" style={{ marginBottom: onShift.length || canEditShift ? "0.5rem" : 0 }}>
            <p className="micro" style={{ letterSpacing: "0.12em", margin: 0 }}>
              この日のシフト
            </p>
            <Link className="micro" href={`/shifts?m=${date.slice(0, 7)}`} style={{ marginLeft: "auto" }}>
              シフト表へ ›
            </Link>
          </div>
          {/* 編集できる人はエディタ側が同じバーをライブで出す（二重に出さない） */}
          {!summary.is_closed && !canEditShift && <ShiftTimeBar entries={shiftBarEntries} />}
          {canEditShift ? (
            // 前後の日に移動したら編集状態を作り直す（key が無いと前の日の下書きが残る）
            <DayShiftEditor
              key={date}
              date={date}
              closeMin={summary.close_min}
              staff={shiftStaff}
              initial={shiftIds}
              initialTimes={dayShifts.times}
            />
          ) : onShift.length > 0 ? (
            <div className="chips">
              {onShift.map((p) => {
                const t = resolveShiftTime(dayShifts.times[p.id] ?? null, p.def);
                return (
                  <span key={p.id} className="shiftchip" style={chipColors(p.colorIndex)}>
                    {p.name}
                    {t ? (
                      <span className="shiftchip__time"> {shiftTimeLabel(t, summary.close_min)}</span>
                    ) : null}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="micro" style={{ margin: 0 }}>
              まだ確定していません。
            </p>
          )}
          {/* 店主指定の注記（2026-08-28）。バーの時間を「確定した勤務時間」と読ませない */}
          {!summary.is_closed && onShift.length > 0 && !canEditShift ? (
            <p className="micro" style={{ margin: "0.4rem 0 0" }}>
              シフト表示は確定ではなく目安です。現場にて店長の判断に従ってください。
            </p>
          ) : null}
        </section>

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
                attention={attentionReason(r)}
                registrar={r.created_by ? (names.get(r.created_by) ?? null) : null}
                note={[r.course_id ? courseNames.get(r.course_id) : null, r.memo]
                  .filter(Boolean)
                  .join("／")}
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
