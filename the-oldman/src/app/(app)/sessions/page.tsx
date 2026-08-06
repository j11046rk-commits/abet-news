import type { Metadata } from "next";
import SessionsClient from "./SessionsClient";
import { requireProfile } from "@/lib/auth";
import { getPlayers, getSessionPlayerNames, getSessions } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "セッション — The Oldman" };
export const dynamic = "force-dynamic";

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const [profile, sessions, players, sp] = await Promise.all([
    requireProfile(),
    getSessions(60),
    getPlayers(),
    searchParams,
  ]);

  const names = await getSessionPlayerNames(sessions.map((s) => s.id));

  // 編集時に参加者を復元するための session_id → player_id[]
  const supabase = await createClient();
  const { data: links } = await supabase
    .from("session_players")
    .select("session_id, player_id")
    .in("session_id", sessions.map((s) => s.id).length ? sessions.map((s) => s.id) : [""]);

  const playerIds: Record<string, string[]> = {};
  for (const l of (links ?? []) as { session_id: string; player_id: string }[]) {
    (playerIds[l.session_id] ??= []).push(l.player_id);
  }

  return (
    <SessionsClient
      meId={profile.id}
      isOwner={profile.role === "owner"}
      sessions={sessions}
      players={players}
      playerNames={Object.fromEntries(names)}
      playerIds={playerIds}
      openForm={sp.new === "1"}
    />
  );
}
