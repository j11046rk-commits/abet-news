"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
  /** イベント営業のチラシ。イベント日は必須 */
  flyer_url: string | null;
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
  // チラシはお客様への説明そのもの。イベント営業なら必ず添える
  if (input.mode === "event" && !input.flyer_url) {
    return { ok: false, error: "イベント営業の日はチラシの画像（またはPDF）が必要です。" };
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
      flyer_url: input.mode === "event" ? input.flyer_url : null,
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

export type FlyerResult = { ok: true; url: string } | { ok: false; error: string };

/** チラシに使えるもの。スマホで撮った写真とPDFを想定する */
const FLYER_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
const FLYER_MAX_BYTES = 10 * 1024 * 1024;

/**
 * イベントのチラシを保存して、お客様が見られるURLを返す。
 * 予約ページ（ログイン不要）から読めるよう、公開バケットに置く。
 */
export async function uploadFlyer(fd: FormData): Promise<FlyerResult> {
  const me = await requireProfile();
  if (!can(me.role, "businessday.write")) return { ok: false, error: "権限がありません。" };

  const file = fd.get("file");
  const date = String(fd.get("date") ?? "");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "ファイルを選んでください。" };
  }
  if (file.size > FLYER_MAX_BYTES) {
    return { ok: false, error: "ファイルが大きすぎます（10MBまで）。" };
  }
  if (!FLYER_TYPES.includes(file.type)) {
    return { ok: false, error: "画像（JPEG・PNG）かPDFを選んでください。" };
  }

  const ext = file.type === "application/pdf" ? "pdf" : (file.name.split(".").pop() || "jpg");
  // 同じ日に貼り替えても古い画像が残らないよう、日付ごとに1枚だけ持つ
  const path = `${date}.${ext.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

  const admin = createAdminClient();
  const { error } = await admin.storage
    .from("flyers")
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: true });
  if (error) return { ok: false, error: "アップロードできませんでした。" };

  const { data } = admin.storage.from("flyers").getPublicUrl(path);
  // 貼り替えたときに古い画像が表示され続けないよう、更新時刻を付ける
  return { ok: true, url: `${data.publicUrl}?v=${Date.now()}` };
}

// 旧・月グリッドの長押し繁忙日トグル（toggleBusy）は、月ビューへの統合で廃止した。
// 繁忙日の切り替えは営業日設定（この画面のフォーム）で行う。
