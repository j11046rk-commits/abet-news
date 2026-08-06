"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { jstToIso } from "@/lib/time";

export type SessionInput = {
  date: string; // YYYY-MM-DD（JST）
  startTime: string; // HH:mm
  endTime: string; // HH:mm（空文字なら未入力）
  rakeYen: number;
  headcount: number;
  note: string;
};

export type ActionResult = { ok: true; id: string } | { ok: false; error: string };

function revalidateAll() {
  revalidatePath("/sessions");
  revalidatePath("/ledger");
  revalidatePath("/");
}

function validate(input: SessionInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "開催日を選んでください。";
  if (!/^\d{2}:\d{2}$/.test(input.startTime)) return "開始時刻を入力してください。";
  if (input.endTime && !/^\d{2}:\d{2}$/.test(input.endTime)) return "終了時刻の形式が不正です。";
  if (!Number.isInteger(input.rakeYen) || input.rakeYen < 0) return "レーキ額を入力してください。";
  if (!Number.isInteger(input.headcount) || input.headcount < 1) return "参加人数を入力してください。";
  return null;
}

/** 終了が開始より前なら翌日として扱う（深夜まで続く卓が普通のため） */
function resolveTimes(input: SessionInput) {
  const startsAt = jstToIso(input.date, input.startTime);
  let endsAt: string | null = null;
  if (input.endTime) {
    const raw = jstToIso(input.date, input.endTime);
    endsAt = raw <= startsAt ? new Date(new Date(raw).getTime() + 86_400_000).toISOString() : raw;
  }
  return { startsAt, endsAt };
}

export async function createSession(input: SessionInput): Promise<ActionResult> {
  const profile = await requireProfile();
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const { startsAt, endsAt } = resolveTimes(input);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sessions")
    .insert({
      started_at: startsAt,
      ended_at: endsAt,
      rake_yen: input.rakeYen,
      headcount: input.headcount,
      note: input.note.trim() || null,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: "記録できませんでした。" };

  // 台帳の income / rake 行は DB トリガが自動で起票する
  revalidateAll();
  return { ok: true, id: data.id };
}

export async function updateSession(id: string, input: SessionInput): Promise<ActionResult> {
  await requireProfile();
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const { startsAt, endsAt } = resolveTimes(input);
  const supabase = await createClient();
  const { error } = await supabase
    .from("sessions")
    .update({
      started_at: startsAt,
      ended_at: endsAt,
      rake_yen: input.rakeYen,
      headcount: input.headcount,
      note: input.note.trim() || null,
    })
    .eq("id", id);

  if (error) return { ok: false, error: "更新できませんでした。" };

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
