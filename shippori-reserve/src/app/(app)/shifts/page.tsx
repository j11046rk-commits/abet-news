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
  getShiftPublication,
  getShiftSubmissions,
} from "@/lib/queries";
import { isRequestWindowOpen, REQUEST_DEADLINE_DAY, requestTargetYm } from "@/lib/shifts";
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
 * シフトタブ。
 * 一般スタッフ＝月のカレンダーにチェックして「希望シフトを提出」（毎月25日締切・来月分）。
 * 店長・オーナー＝希望を見ながら下書きを組み、「シフトを確定」して暦に載せる。
 * 店長は火曜（休業日）以外デフォルト出勤で、休みたい日を外す方式。オーナー3名は対象外。
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

  const [summaries, confirmedMap, requestMap, submissionsMap, publishedAt, profiles, settings] =
    await Promise.all([
      getMonthSummaries(ym),
      getMonthShifts(ym),
      getMonthShiftRequests(ym),
      getShiftSubmissions(ym),
      getShiftPublication(ym),
      getAllProfiles(),
      getSettings(),
    ]);

  // オーナーはシフトに入らない（店主指定）。色は全員リストの並びで安定させる。
  const staff: BoardStaff[] = profiles
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.is_active && p.role !== "owner" && p.role !== "viewer")
    .map(({ p, i }) => ({ id: p.id, name: surname(p.display_name), colorIndex: i }));

  const manager = profiles.find((p) => p.role === "manager" && p.is_active);

  // 「希望の提出」欄に出すのは提出する側（一般スタッフ）だけ。店長は組む側なので出さない。
  const submitterIds = profiles
    .filter((p) => p.is_active && p.role === "staff")
    .map((p) => p.id);

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

  // 確定シフトの下書き初期値。
  // まだ何も組んでいない月は、店長を休業日以外ぜんぶ出勤にしておく（火曜以外デフォルト出勤・店主指定）。
  const confirmedInit: Record<string, string[]> = Object.fromEntries(confirmedMap);
  if (mode === "manage" && manager && !publishedAt && confirmedMap.size === 0) {
    for (const d of days) {
      if (!d.closed) confirmedInit[d.date] = [manager.id];
    }
  }

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
            {mode === "manage"
              ? publishedAt
                ? "確定済み。タップで直して「確定し直す」で反映"
                : "点線＝希望あり・タップで下書き・ボタンで確定"
              : "出勤できる日を◯にして提出"}
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
                <strong> 今月{REQUEST_DEADLINE_DAY}日まで </strong>。
                タップして出勤できる日を◯・できない日を×にし、下の提出ボタンを押してください。
              </p>
            ) : (
              <p className="notice notice-strong">
                {fmtMonthJa(`${targetYm}-01`)}分の提出は締め切りました。変更は店長に伝えてください。
              </p>
            )
          ) : (
            <p className="micro">
              希望を出せるのは来月（{fmtMonthJa(`${targetYm}-01`)}）分だけです。この月は見るだけになります。
            </p>
          )
        ) : null}

        <ShiftBoard
          // 月を移動したら下書きを作り直す（key が無いと前の月の下書きが残る）
          key={ym}
          ym={ym}
          days={days}
          staff={staff}
          confirmedInit={confirmedInit}
          requests={Object.fromEntries(requestMap)}
          submissions={Object.fromEntries(submissionsMap)}
          submitterIds={submitterIds}
          mySubmittedAt={submissionsMap.get(me.id) ?? null}
          publishedAt={publishedAt}
          mode={mode}
          myId={me.id}
          requestOpen={requestOpen}
        />

        <div style={{ height: "2rem" }} />
      </div>
    </>
  );
}
