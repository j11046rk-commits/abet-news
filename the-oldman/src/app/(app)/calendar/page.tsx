import type { Metadata } from "next";
import CalendarView from "./CalendarView";
import { requireProfile } from "@/lib/auth";
import { getProfiles, getReservationsBetween } from "@/lib/queries";
import { addDaysJst, fmtDate, jstHourToIso, nowJst, startOfMonthJst, startOfWeekJst } from "@/lib/time";

export const metadata: Metadata = { title: "カレンダー — The Oldman" };
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

  const [profile, reservations, profiles] = await Promise.all([
    requireProfile(),
    getReservationsBetween(
      jstHourToIso(rangeStart, 0),
      jstHourToIso(fmtDate(addDaysJst(new Date(`${rangeStart}T00:00:00+09:00`), span)), 0),
    ),
    getProfiles(),
  ]);

  return (
    <CalendarView
      view={view}
      anchor={anchor}
      reservations={reservations}
      names={Object.fromEntries(profiles.map((p) => [p.id, p.display_name]))}
      meId={profile.id}
      isOwner={profile.role === "owner"}
    />
  );
}
