"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ReservationPurpose } from "@/lib/types";

export type Result = { ok: true } | { ok: false; error: string };

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/sessions");
  revalidatePath("/ledger");
  revalidatePath("/reservations");
  revalidatePath("/calendar");
  revalidatePath("/members");
}

export type CheckInInput = {
  purposes: ReservationPurpose[];
  headcount: number;
  memo: string;
};

/**
 * いま施設に入った。
 *
 * 用途と人数も一緒に受け取る。TOPで知りたいのは「誰がいるか」だけでなく
 * 「いま何人いて、何をしているか」なので、入るときに聞いてしまう。
 *
 * 滞在中の行が既にあれば、そちらの内容を書き換える（用途を選び直せる）。
 */
export async function checkIn(input: CheckInInput): Promise<Result> {
  const profile = await requireProfile();

  if (input.purposes.length === 0) return { ok: false, error: "用途を1つ以上選んでください。" };
  if (!Number.isInteger(input.headcount) || input.headcount < 1 || input.headcount > 30)
    return { ok: false, error: "人数を確かめてください。" };

  const supabase = await createClient();
  const row = {
    purposes: input.purposes,
    headcount: input.headcount,
    memo: input.memo.trim() || null,
  };

  const { data: open } = await supabase
    .from("check_ins")
    .select("id")
    .eq("profile_id", profile.id)
    .is("checked_out_at", null)
    .maybeSingle<{ id: string }>();

  const { error } = open
    ? await supabase.from("check_ins").update(row).eq("id", open.id)
    : await supabase.from("check_ins").insert({ profile_id: profile.id, ...row });

  if (error) return { ok: false, error: "チェックインできませんでした。" };

  revalidateAll();
  return { ok: true };
}

/** 施設を出た。滞在中の行に退出時刻を入れる。 */
export async function checkOut(): Promise<Result> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("check_ins")
    .update({ checked_out_at: new Date().toISOString() })
    .eq("profile_id", profile.id)
    .is("checked_out_at", null);

  if (error) return { ok: false, error: "チェックアウトできませんでした。" };

  revalidateAll();
  return { ok: true };
}

/**
 * 記録し終えた滞在をあとから直す。
 *
 * 押し忘れ・押し間違いは必ず起きる。朝10時の自動締めも「本当は何時に帰ったか」
 * までは知らないので、直せる場所が要る。
 *
 * 直せるのは自分の行だけ（RLS もそうなっている）。何時にいたかは本人しか
 * 知らないので、他人が書き換えられる状態にはしない。
 */
export async function updateCheckIn(
  id: string,
  input: CheckInInput & { checkedInAt: string; checkedOutAt: string | null },
): Promise<Result> {
  await requireProfile();

  if (input.purposes.length === 0) return { ok: false, error: "用途を1つ以上選んでください。" };
  if (!Number.isInteger(input.headcount) || input.headcount < 1 || input.headcount > 30)
    return { ok: false, error: "人数を確かめてください。" };

  const inAt = new Date(input.checkedInAt);
  if (Number.isNaN(inAt.getTime())) return { ok: false, error: "入った時刻を確かめてください。" };
  if (input.checkedOutAt !== null) {
    const outAt = new Date(input.checkedOutAt);
    if (Number.isNaN(outAt.getTime())) return { ok: false, error: "出た時刻を確かめてください。" };
    if (outAt <= inAt) return { ok: false, error: "出た時刻は入った時刻より後にしてください。" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("check_ins")
    .update({
      checked_in_at: inAt.toISOString(),
      checked_out_at: input.checkedOutAt ? new Date(input.checkedOutAt).toISOString() : null,
      purposes: input.purposes,
      headcount: input.headcount,
      memo: input.memo.trim() || null,
      // 手で直した以上、もう「自動で締めた行」ではない
      auto_closed: false,
    })
    .eq("id", id)
    .select("id");

  if (error) return { ok: false, error: "更新できませんでした。" };
  if (!data || data.length === 0) return { ok: false, error: "自分の記録だけが直せます。" };

  revalidateAll();
  return { ok: true };
}

export async function deleteCheckIn(id: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.from("check_ins").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: "削除できませんでした。" };
  if (!data || data.length === 0) return { ok: false, error: "自分の記録だけが消せます。" };
  revalidateAll();
  return { ok: true };
}
