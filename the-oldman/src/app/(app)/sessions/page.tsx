import type { Metadata } from "next";
import SessionsClient from "./SessionsClient";
import { requireProfile } from "@/lib/auth";
import { getProfiles, getSessions } from "@/lib/queries";

export const metadata: Metadata = { title: "セッション — The Oldman" };
export const dynamic = "force-dynamic";

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const [profile, sessions, profiles, sp] = await Promise.all([
    requireProfile(),
    getSessions(60),
    getProfiles(),
    searchParams,
  ]);

  return (
    <SessionsClient
      meId={profile.id}
      isOwner={profile.role === "owner"}
      sessions={sessions}
      names={Object.fromEntries(profiles.map((p) => [p.id, p.display_name]))}
      openForm={sp.new === "1"}
    />
  );
}
