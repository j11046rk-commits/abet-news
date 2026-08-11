import Link from "next/link";
import NoteLine from "@/components/NoteLine";
import ScrollTo from "@/components/ScrollTo";
import { requirePermission } from "@/lib/auth";
import { SOURCE_SHORT } from "@/lib/constants";
import { isHoliday } from "@/lib/holidays";
import { computeSeatUsage, isSeatFull, seatKind, seatShort } from "@/lib/seats";
import { chipColors, surname } from "@/lib/staff";
import {
  deriveBusinessDay,
  getAllProfiles,
  getCourses,
  getMonthReservations,
  getMonthSales,
  getMonthShifts,
  getMonthSummaries,
  getSeatUnits,
  getSettings,
  getShiftPublication,
} from "@/lib/queries";
import { fmtYen, hitOf, salesView, shownYen } from "@/lib/sales";
import {
  fmtMonthJa,
  fmtYm,
  monthRange,
  shiftDate,
  shiftMonth,
  startLabel,
  todayBizDate,
  weekdayOf,
  WEEKDAY_JA,
} from "@/lib/time";
import type { Reservation } from "@/lib/types";

export const dynamic = "force-dynamic";

const YM_RE = /^\d{4}-\d{2}$/;

/**
 * 暦（ホーム）。縦スクロールの1か月。開いた位置は今日。
 *
 * 店で使ってきたカレンダーアプリの良さ——シフトが一目・受付者が一目・
 * その日をタップすればすぐ入力——をこの1画面に引き継ぐ。
 * 月グリッドは廃止した（1画面に収めるより、指で流して見えるほうが速い）。
 */
export default async function MonthPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  await requirePermission("reservation.read");
  const sp = await searchParams;
  const today = todayBizDate();
  const ym = YM_RE.test(sp.m ?? "") ? sp.m! : fmtYm(today);

  const [summaries, resvMap, shiftMapRaw, shiftsPublishedAt, profiles, seatUnits, courses, settings, salesMap] =
    await Promise.all([
      getMonthSummaries(ym),
      getMonthReservations(ym),
      getMonthShifts(ym),
      getShiftPublication(ym),
      getAllProfiles(),
      getSeatUnits(),
      getCourses(),
      getSettings(),
      getMonthSales(ym),
    ]);

  // シフトは店長が「確定」した月だけ暦に出す（組みかけの下書きを見せない）
  const shiftMap = shiftsPublishedAt ? shiftMapRaw : new Map<string, string[]>();

  const names = new Map(profiles.map((p) => [p.id, p.display_name]));
  const colorIndex = new Map(profiles.map((p, i) => [p.id, i]));
  const courseNames = new Map(courses.map((c) => [c.id, c.name]));

  const { from, to } = monthRange(ym);
  const dates: string[] = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) dates.push(d);

  /** 行の右端に出す「受付した人」。HPからの自動受付は流入元の略称で埋める。 */
  const registrar = (r: Reservation): string =>
    (r.created_by && names.get(r.created_by)?.split(/[\s　]/)[0]) || SOURCE_SHORT[r.source];

  return (
    <>
      <header className="appbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-face.png" alt="しっぽり亭" className="appbar__logo" />
        <Link className="btn btn-sm" href={`/?m=${fmtYm(shiftMonth(`${ym}-01`, -1))}`} aria-label="前の月">
          ‹
        </Link>
        <div className="appbar__title">{fmtMonthJa(`${ym}-01`)}</div>
        <Link className="btn btn-sm" href={`/?m=${fmtYm(shiftMonth(`${ym}-01`, 1))}`} aria-label="次の月">
          ›
        </Link>
        <div className="appbar__spacer" />
        <Link className="btn btn-sm" href="/reservations" aria-label="予約の検索">
          検索
        </Link>
      </header>

      <div className="wrap" style={{ paddingTop: "0.4rem" }}>
        {dates.map((date) => {
          const day = summaries.get(date) ?? deriveBusinessDay(date, settings);
          const rows = resvMap.get(date) ?? [];
          // 休業日は誰も出勤しない。確定したあとで臨時休業にした日は
          // シフトの行が残るので、ここで出さない（「休」なのに名前が並ぶのを防ぐ）。
          const shiftIds = day.is_closed ? [] : (shiftMap.get(date) ?? []);
          const dow = weekdayOf(date);
          const guests = summaries.get(date)?.guest_count ?? 0;
          const usage = computeSeatUsage(rows);
          // 日毎の売上は店内だけで見る（物販は月間の合計にだけ入れる・店主指示 2026-08）
          const sale = salesView(salesMap.get(date));
          const saleHit = hitOf(sale);
          const saleDineIn = shownYen(sale.dineIn);

          const rowCls = [
            "mrow",
            date === today ? "mrow--today" : "",
            day.mode === "event" ? "mrow--event" : "",
            day.is_closed && rows.length === 0 ? "mrow--closed" : "",
            saleHit ? "mrow--hit" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <section key={date} id={`d-${date}`} className={rowCls}>
              <Link href={`/day/${date}`} className="mrow__date" aria-label={`${date} を開く`}>
                <span className="mrow__day">{Number(date.slice(8))}</span>
                <span
                  className={`mrow__dow ${dow === 0 || isHoliday(date) ? "mrow__dow--sun" : dow === 6 ? "mrow__dow--sat" : ""}`}
                >
                  {WEEKDAY_JA[dow]}
                </span>
                {guests > 0 ? <span className="mrow__guests">{guests}名</span> : null}
              </Link>

              <div className="mrow__body">
                <div className="mrow__top">
                  {day.is_closed ? <span className="badge badge--closed">休</span> : null}
                  {day.mode === "event" ? (
                    <span className="badge badge--event">{day.event_name || "イベント"}</span>
                  ) : null}

                  {shiftIds.map((id) => (
                    <span key={id} className="shiftchip" style={chipColors(colorIndex.get(id) ?? 0)}>
                      {surname(names.get(id) ?? "?")}
                    </span>
                  ))}

                  <Link
                    className="mrow__add"
                    href={`/reservations/new?d=${date}`}
                    aria-label={`${date} に予約を登録`}
                  >
                    ＋
                  </Link>
                </div>

                {/* 席の空き状況。予約の有無にかかわらず常に出す（店主指定）。 */}
                {day.mode === "normal" ? (
                  <div className="seatstrip" aria-label="席の空き状況">
                    {seatUnits.map((u) => {
                      const full = isSeatFull(u, usage, 1);
                      return (
                        <span
                          key={u.id}
                          className={`seatchip ${full ? "seatchip--full" : ""}`}
                        >
                          {seatShort(u)}
                          {u.is_shared ? ` ${usage.counter_used}/${u.capacity}` : ""}
                        </span>
                      );
                    })}
                  </div>
                ) : null}

                {/* 日毎の売上（目標と店内の実績）。1円単位で省略なし（店主指定）。 */}
                {/* 中身が1つも無いときは行ごと出さない（火曜定休は目標0なので空の行になる） */}
                {(sale.target ?? 0) > 0 || saleDineIn != null || sale.retail > 0 ? (
                  <div className="salesline" aria-label="売上の目標と実績">
                    {saleDineIn != null ? (
                      <span className={`salesline__actual ${saleHit ? "salesline__actual--hit" : ""}`}>
                        店内 {fmtYen(saleDineIn)}
                      </span>
                    ) : null}
                    {sale.retail > 0 ? (
                      <span className="salesline__retail">物販 {fmtYen(sale.retail)}</span>
                    ) : null}
                    {sale.target ? <span>目標 {fmtYen(sale.target)}</span> : null}
                  </div>
                ) : null}

                {rows.map((r) => {
                  const off = r.status === "cancelled" || r.status === "no_show";
                  const note = [
                    r.course_id ? courseNames.get(r.course_id) : null,
                    r.memo,
                  ]
                    .filter(Boolean)
                    .join("／");
                  return (
                    <div key={r.id} className={`mcard mcard--${seatKind(r.seat_note) || "none"}`}>
                      <Link
                        href={`/reservations/${r.id}`}
                        className={`mline ${off ? "mline--off" : ""}`}
                      >
                        <span className="mline__time">{startLabel(r)}</span>
                        <span className="mline__name">
                          {r.customer_name}
                          <span className="muted"> 様 {r.party_size}名</span>
                        </span>
                        {r.seat_note ? <span className="muted">{r.seat_note}</span> : null}
                        <span className="mline__reg">{registrar(r)}</span>
                      </Link>
                      {note && !off ? <NoteLine text={note} /> : null}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        <div style={{ height: "2rem" }} />
      </div>

      {ym === today.slice(0, 7) ? <ScrollTo id={`d-${today}`} /> : null}
    </>
  );
}
