"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { todayBizDate } from "@/lib/time";
import type { Reservation } from "@/lib/types";

type ResvLite = Pick<
  Reservation,
  | "id"
  | "reference"
  | "biz_date"
  | "starts_at"
  | "party_size"
  | "customer_name"
  | "seat_note"
  | "source"
  | "status"
>;

export type BoardSnapshot = {
  date: string;
  /** 'T1'|'T2'|'T3'|'和室' → 1(使用中) ／ 'C' → 使用席数 */
  board: Record<string, number>;
  /** 今日の予約（横の一覧に出す） */
  reservations: ResvLite[];
  /** 直近24時間に入ったネット予約（未来日を含む・お知らせの監視対象） */
  recent_net: ResvLite[];
};

/** 席ボードの現在の状態と今日の予約（タブレットが15秒ごとに呼ぶ） */
export async function getBoardSnapshot(): Promise<BoardSnapshot> {
  await requireProfile();
  const date = todayBizDate();
  const supabase = await createClient();

  const FIELDS =
    "id, reference, biz_date, starts_at, party_size, customer_name, seat_note, source, status";
  const [boardQ, resvQ, netQ] = await Promise.all([
    supabase.from("seat_board").select("key, occupied").eq("biz_date", date),
    supabase
      .from("reservations")
      .select(FIELDS)
      .eq("biz_date", date)
      .in("status", ["tentative", "confirmed", "seated"])
      .order("starts_at"),
    supabase
      .from("reservations")
      .select(FIELDS)
      .eq("source", "web_form")
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const board: Record<string, number> = {};
  for (const b of (boardQ.data ?? []) as { key: string; occupied: number }[]) {
    board[b.key] = b.occupied;
  }
  return {
    date,
    board,
    reservations: (resvQ.data ?? []) as ResvLite[],
    recent_net: (netQ.data ?? []) as ResvLite[],
  };
}

/** 席のタップを保存する。卓は0/1・カウンターは使用席数 */
export async function setSeatState(
  key: string,
  value: number,
): Promise<{ ok: boolean; error?: string }> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_seat_board", {
    p_date: todayBizDate(),
    p_key: key,
    p_value: value,
  });
  if (error) return { ok: false, error: "保存できませんでした。" };
  return { ok: true };
}
