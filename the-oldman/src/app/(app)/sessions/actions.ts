"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { jstToIso } from "@/lib/time";
import type { GameType } from "@/lib/types";

export type SessionInput = {
  date: string; // YYYY-MM-DD（JST）
  startTime: string; // HH:mm
  endTime: string; // HH:mm（空文字なら未入力）
  gameType: GameType;
  rakeYen: number;
  note: string;
  /** 既存プレイヤーのID */
  playerIds: string[];
  /** 新規ゲストの名前 */
  newGuests: string[];
};

export type ActionResult = { ok: true; id: string } | { ok: false; error: string };

function revalidateAll() {
  revalidatePath("/sessions");
  revalidatePath("/ledger");
  revalidatePath("/members");
  revalidatePath("/");
}

function validate(input: SessionInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "開催日を選んでください。";
  if (!/^\d{2}:\d{2}$/.test(input.startTime)) return "開始時刻を入力してください。";
  if (input.endTime && !/^\d{2}:\d{2}$/.test(input.endTime)) return "終了時刻の形式が不正です。";
  if (!Number.isInteger(input.rakeYen) || input.rakeYen < 0) return "レーキ額を入力してください。";
  return null;
}

/** 新規ゲストを players に起こし、既存と合わせた player_id の配列を返す */
async function resolvePlayers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  playerIds: string[],
  newGuests: string[],
): Promise<string[]> {
  const ids = [...playerIds];
  for (const raw of newGuests) {
    const name = raw.trim();
    if (!name) continue;

    const { data: existing } = await supabase
      .from("players")
      .select("id")
      .eq("name", name)
      .maybeSingle();

    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const { data: created } = await supabase
      .from("players")
      .insert({ name })
      .select("id")
      .single();
    if (created) ids.push(created.id);
  }
  return Array.from(new Set(ids));
}

export async function createSession(input: SessionInput): Promise<ActionResult> {
  const profile = await requireProfile();
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const startsAt = jstToIso(input.date, input.startTime);

  // 終了が開始より前なら翌日扱い（深夜まで続く卓が普通なので）
  let endsAt: string | null = null;
  if (input.endTime) {
    const raw = jstToIso(input.date, input.endTime);
    endsAt = raw <= startsAt ? new Date(new Date(raw).getTime() + 86_400_000).toISOString() : raw;
  }

  const { data, error } = await supabase
    .from("sessions")
    .insert({
      started_at: startsAt,
      ended_at: endsAt,
      game_type: input.gameType,
      rake_yen: input.rakeYen,
      note: input.note.trim() || null,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: "記録できませんでした。" };

  const ids = await resolvePlayers(supabase, input.playerIds, input.newGuests);
  if (ids.length > 0) {
    await supabase
      .from("session_players")
      .insert(ids.map((player_id) => ({ session_id: data.id, player_id })));
  }

  // 台帳の income / rake 行は DB トリガが自動で起票する（二重入力させない）
  revalidateAll();
  return { ok: true, id: data.id };
}

export async function updateSession(id: string, input: SessionInput): Promise<ActionResult> {
  await requireProfile();
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const startsAt = jstToIso(input.date, input.startTime);

  let endsAt: string | null = null;
  if (input.endTime) {
    const raw = jstToIso(input.date, input.endTime);
    endsAt = raw <= startsAt ? new Date(new Date(raw).getTime() + 86_400_000).toISOString() : raw;
  }

  const { error } = await supabase
    .from("sessions")
    .update({
      started_at: startsAt,
      ended_at: endsAt,
      game_type: input.gameType,
      rake_yen: input.rakeYen,
      note: input.note.trim() || null,
    })
    .eq("id", id);

  if (error) return { ok: false, error: "更新できませんでした。" };

  const ids = await resolvePlayers(supabase, input.playerIds, input.newGuests);
  await supabase.from("session_players").delete().eq("session_id", id);
  if (ids.length > 0) {
    await supabase
      .from("session_players")
      .insert(ids.map((player_id) => ({ session_id: id, player_id })));
  }

  revalidateAll();
  return { ok: true, id };
}

export async function deleteSession(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from("sessions").delete().eq("id", id);
  if (error) return { ok: false, error: "削除できませんでした。" };
  revalidateAll();
  return { ok: true };
}
