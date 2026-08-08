"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { can } from "@/lib/constants";

export type DayResult = { ok: true } | { ok: false; error: string };

export type BusinessDayInput = {
  biz_date: string;
  mode: "normal" | "event";
  is_busy: boolean;
  is_closed: boolean;
  event_name: string;
  event_capacity: number | null;
  open_min: number;
  close_min: number;
  note: string;
};

/**
 * 営業日を保存する。行が無い日は、ここで初めて実体化される。
 * 「見ただけの日」がDBに溜まらないよう、読むときは導出、書くときに作る。
 */
export async function saveBusinessDay(input: BusinessDayInput): Promise<DayResult> {
  const me = await requireProfile();
  if (!can(me.role, "businessday.write")) return { ok: false, error: "権限がありません。" };

  if (input.mode === "event" && (!input.event_capacity || input.event_capacity <= 0)) {
    return { ok: false, error: "イベント営業の日は定員（総受け入れ人数）を入れてください。" };
  }
  if (input.close_min <= input.open_min) {
    return { ok: false, error: "閉店時刻は開店時刻より後にしてください。" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("business_days").upsert(
    {
      biz_date: input.biz_date,
      mode: input.mode,
      is_busy: input.is_busy,
      is_closed: input.is_closed,
      event_name: input.mode === "event" ? input.event_name.trim() || null : null,
      event_capacity: input.mode === "event" ? input.event_capacity : null,
      open_min: input.open_min,
      close_min: input.close_min,
      note: input.note.trim() || null,
      updated_by: me.id,
    },
    { onConflict: "biz_date" },
  );

  if (error) return { ok: false, error: "保存できませんでした。" };

  revalidatePath("/");
  revalidatePath(`/day/${input.biz_date}`);
  revalidatePath(`/calendar/${input.biz_date}`);
  return { ok: true };
}

// 旧・月グリッドの長押し繁忙日トグル（toggleBusy）は、月ビューへの統合で廃止した。
// 繁忙日の切り替えは営業日設定（この画面のフォーム）で行う。
