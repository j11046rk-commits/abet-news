"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { jstHourToIso } from "@/lib/time";
import type { ReservationPurpose } from "@/lib/types";

export type ReservationInput = {
  date: string; // YYYY-MM-DD（JST）
  startHour: number; // 0..23
  endHour: number; // 1..24
  purposes: ReservationPurpose[];
  isExclusive: boolean;
  headcount: number;
  memo: string;
  title: string;
};

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

function validate(input: ReservationInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "日付を選んでください。";
  if (input.endHour <= input.startHour) return "終了時刻は開始時刻より後にしてください。";
  if (input.purposes.length === 0) return "用途を1つ以上選んでください。";
  if (input.purposes.includes("other") && input.memo.trim() === "")
    return "用途に「その他」を含む場合はメモを入力してください。";
  if (!Number.isInteger(input.headcount) || input.headcount < 1) return "想定人数を入力してください。";
  return null;
}

function revalidateAll() {
  revalidatePath("/reservations");
  revalidatePath("/calendar");
  revalidatePath("/");
  revalidatePath("/members");
}

export async function createReservation(input: ReservationInput): Promise<ActionResult> {
  const profile = await requireProfile();
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .insert({
      title: input.title.trim() || null,
      purposes: input.purposes,
      is_exclusive: input.isExclusive,
      starts_at: jstHourToIso(input.date, input.startHour),
      ends_at: jstHourToIso(input.date, input.endHour),
      headcount: input.headcount,
      memo: input.memo.trim() || null,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: "予約を保存できませんでした。" };

  revalidateAll();
  return { ok: true, id: data.id };
}

export async function updateReservation(id: string, input: ReservationInput): Promise<ActionResult> {
  await requireProfile();
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const { error } = await supabase
    .from("reservations")
    .update({
      title: input.title.trim() || null,
      purposes: input.purposes,
      is_exclusive: input.isExclusive,
      starts_at: jstHourToIso(input.date, input.startHour),
      ends_at: jstHourToIso(input.date, input.endHour),
      headcount: input.headcount,
      memo: input.memo.trim() || null,
    })
    .eq("id", id);

  // RLS で弾かれた場合もここに来る
  if (error) return { ok: false, error: "予約を更新できませんでした。" };

  revalidateAll();
  return { ok: true, id };
}

export async function deleteReservation(id: string): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from("reservations").delete().eq("id", id);
  if (error) return { ok: false, error: "予約を削除できませんでした。" };

  revalidateAll();
  return { ok: true };
}
