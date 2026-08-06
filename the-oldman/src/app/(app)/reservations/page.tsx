import type { Metadata } from "next";
import Link from "next/link";
import ReservationsClient from "./ReservationsClient";
import { requireProfile } from "@/lib/auth";
import { getPastReservations, getProfiles, getUpcomingReservations } from "@/lib/queries";

export const metadata: Metadata = { title: "予約 — The Oldmans" };
export const dynamic = "force-dynamic";

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; start?: string; end?: string; new?: string }>;
}) {
  const [profile, upcoming, past, profiles, sp] = await Promise.all([
    requireProfile(),
    getUpcomingReservations(),
    getPastReservations(),
    getProfiles(),
    searchParams,
  ]);

  const names = Object.fromEntries(profiles.map((p) => [p.id, p.display_name]));

  return (
    <>
      <header className="page">
        <h1 className="display">予約</h1>
        <p className="dim page__lead">
          施設の稼働を共有します。重複は止めません。話し合いで決めてください。
        </p>
        <Link href="/calendar" className="micro page__aside">
          カレンダーで見る →
        </Link>
      </header>

      <ReservationsClient
        meId={profile.id}
        isOwner={profile.role === "owner"}
        names={names}
        upcoming={upcoming}
        past={past}
        presetDate={sp.date}
        presetStart={sp.start ? Number(sp.start) : undefined}
        presetEnd={sp.end ? Number(sp.end) : undefined}
        openForm={sp.new === "1" || Boolean(sp.date)}
      />

      {/* 誰がどれだけ貸切に使ったかは、予約を見に来たついでに確かめるもの。 */}
      <nav className="backdoor">
        <Link href="/members" className="micro">
          メンバー・貸切時間 →
        </Link>
      </nav>
    </>
  );
}
