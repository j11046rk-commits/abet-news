import Link from "next/link";
import ShiftBoard, { type BoardDay, type BoardStaff } from "@/components/ShiftBoard";
import { requireProfile } from "@/lib/auth";
import { can } from "@/lib/constants";
import { surname } from "@/lib/staff";
import {
  deriveBusinessDay,
  getAllProfiles,
  getMonthShiftRequests,
  getMonthShifts,
  getMonthSummaries,
  getSettings,
} from "@/lib/queries";
import { isRequestWindowOpen, REQUEST_DEADLINE_DAY, requestTargetYm } from "@/lib/shifts";
import { fmtMonthJa, fmtYm, monthRange, shiftDate, shiftMonth, todayBizDate, WEEKDAY_JA, weekdayOf } from "@/lib/time";

export const dynamic = "force-dynamic";

const YM_RE = /^\d{4}-\d{2}$/;

/**
 * シフトタブ。
 * 一般スタッフ＝毎月25日までに来月の希望を出す。店長・オーナー＝希望を見ながら確定を組む。
 * 暦に出るのは確定シフトだけ。オーナー3名はシフトに入らない。
 */
export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const me = await requireProfile();
  const sp = await searchParams;

  const manage = can(me.role, "shift.write");
  const request = can(me.role, "shiftrequest.write");
  const mode = manage ? "manage" : request ? "request" : "view";

  const targetYm = requestTargetYm();
  const windowOpen = isRequestWindowOpen();

  // スタッフは「来月の希望を出す」のが主目的なので来月を、店長は今月を最初に見せる
  const defaultYm = mode === "request" ? targetYm : fmtYm(todayBizDate());
  const ym = YM_RE.test(sp.m ?? "") ? sp.m! : defaultYm;

  const [summaries, confirmedMap, requestMap, profiles, settings] = await Promise.all([
    getMonthSummaries(ym),
    getMonthShifts(ym),
    getMonthShiftRequests(ym),
    getAllProfiles(),
    getSettings(),
  ]);

  // オーナーはシフトに入らない（店主指定）。色は全員リストの並びで安定させる。
  const staff: BoardStaff[] = profiles
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.is_active && p.role !== "owner" && p.role !== "viewer")
    .map(({ p, i }) => ({ id: p.id, name: surname(p.display_name), colorIndex: i }));

  const { from, to } = monthRange(ym);
  const days: BoardDay[] = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    const dow = weekdayOf(d);
    const summary = summaries.get(d);
    days.push({
      date: d,
      day: Number(d.slice(8)),
      dow,
      dowLabel: WEEKDAY_JA[dow],
      closed: summary?.is_closed ?? deriveBusinessDay(d, settings).is_closed,
    });
  }

  const toObj = (m: Map<string, string[]>) => Object.fromEntries(m);
  const isTargetMonth = ym === targetYm;
  const requestOpen = mode === "request" && isTargetMonth && windowOpen;

  return (
    <>
      <header className="appbar">
        <Link className="btn btn-sm" href={`/shifts?m=${fmtYm(shiftMonth(`${ym}-01`, -1))}`} aria-label="前の月">
          ‹
        </Link>
        <div>
          <div className="appbar__title">{fmtMonthJa(`${ym}-01`)} シフト</div>
          <div className="appbar__sub">
            {mode === "manage" ? "点線＝希望あり・タップで確定" : "自分の名前をタップで希望"}
          </div>
        </div>
        <Link className="btn btn-sm" href={`/shifts?m=${fmtYm(shiftMonth(`${ym}-01`, 1))}`} aria-label="次の月">
          ›
        </Link>
      </header>

      <div className="wrap stack">
        {mode === "request" ? (
          isTargetMonth ? (
            windowOpen ? (
              <p className="notice">
                {fmtMonthJa(`${targetYm}-01`)}の希望シフトは
                <strong> 今月{REQUEST_DEADLINE_DAY}日まで </strong>
                に出してください。入れる日の自分の名前をタップ（もう一度で取り下げ）。
              </p>
            ) : (
              <p className="notice notice-strong">
                {fmtMonthJa(`${targetYm}-01`)}分の提出は締め切りました。変更は店長に伝えてください。
              </p>
            )
          ) : (
            <p className="micro">
              希望を出せるのは来月（{fmtMonthJa(`${targetYm}-01`)}）分だけです。
              この月は見るだけになります。
            </p>
          )
        ) : mode === "manage" ? (
          <p className="micro">
            点線＝本人の希望あり。名前をタップすると確定に入ります（もう一度で外れます）。
            確定したシフトが暦に表示されます。
          </p>
        ) : null}

        <ShiftBoard
          days={days}
          staff={staff}
          confirmed={toObj(confirmedMap)}
          requests={toObj(requestMap)}
          mode={mode}
          myId={me.id}
          requestOpen={requestOpen}
        />

        <div style={{ height: "2rem" }} />
      </div>
    </>
  );
}
