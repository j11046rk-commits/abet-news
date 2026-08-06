import type { Metadata } from "next";
import CalendarView from "./CalendarView";
import { requireProfile } from "@/lib/auth";
import {
  getCheckInsBetween,
  getProfiles,
  getReservationsBetween,
  getSessionsBetween,
} from "@/lib/queries";
import { addDaysJst, fmtDate, jstHourToIso, nowJst, startOfMonthJst, startOfWeekJst } from "@/lib/time";

export const metadata: Metadata = { title: "カレンダー — The Oldmans" };
export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === "month" ? "month" : "week";
  const anchor = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : fmtDate(nowJst());

  // 取得範囲は表示範囲より広めに取る（3日表示への切替や月グリッドのはみ出しに備える）
  const rangeStart =
    view === "month"
      ? fmtDate(startOfWeekJst(startOfMonthJst(new Date(`${anchor}T00:00:00+09:00`))))
      : fmtDate(startOfWeekJst(new Date(`${anchor}T00:00:00+09:00`)));
  const span = view === "month" ? 42 : 15;

  const rangeEnd = jstHourToIso(
    fmtDate(addDaysJst(new Date(`${rangeStart}T00:00:00+09:00`), span)),
    0,
  );

  const [profile, reservations, visits, sessions, profiles] = await Promise.all([
    requireProfile(),
    getReservationsBetween(jstHourToIso(rangeStart, 0), rangeEnd),
    getCheckInsBetween(jstHourToIso(rangeStart, 0), rangeEnd),
    getSessionsBetween(jstHourToIso(rangeStart, 0), rangeEnd),
    getProfiles(),
  ]);

  return (
    <CalendarView
      view={view}
      anchor={anchor}
      reservations={reservations}
      visits={visits}
      sessions={sessions}
      names={Object.fromEntries(profiles.map((p) => [p.id, p.display_name]))}
      meId={profile.id}
      isOwner={profile.role === "owner"}
    />
  );
}
