"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { can } from "@/lib/constants";
import { getBusinessDay } from "@/lib/queries";
import { nowJst, todayBizDate } from "@/lib/time";
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
  /** 'T1'|'T2'|'T3'|'和室' → 1(使用中) ／ 'C1'〜'C10' → その丸椅子が使用中か(0/1) */
  board: Record<string, number>;
  /** 今日の予約（横の一覧に出す） */
  reservations: ResvLite[];
  /** 直近24時間に入ったネット予約（未来日を含む・お知らせの監視対象） */
  recent_net: ResvLite[];
  /** ネット予約の受付停止（当日分だけ止める） */
  pause: PauseState;
  /** いま営業時間内か（停止ボタンは営業中しか押せない） */
  open_now: boolean;
};

export type PauseState = {
  /** いま止まっているか */
  on: boolean;
  /** 止め始めた時刻（ISO・止まっているときだけ） */
  since: string | null;
  /** 今日の停止時間の合計（分） */
  today_min: number;
  /** 今月の停止時間の合計（分）と回数 */
  month_min: number;
  month_count: number;
};

type PauseRow = { biz_date: string; started_at: string; ended_at: string | null };

/**
 * 停止していた長さを分で数える。
 * 再開し忘れても青天井にならないよう、開いたままの記録はその営業日の
 * 終わり（翌朝4時＝営業日の切り替わり）で頭打ちにする。
 */
/**
 * いま営業時間内か。
 * 営業日は朝4時で切り替わるので、深夜1時なら「前日の25時」として数える。
 */
function isOpenNow(openMin: number, closeMin: number): boolean {
  const n = nowJst();
  const min = n.getHours() * 60 + n.getMinutes() + (n.getHours() < 4 ? 24 * 60 : 0);
  return min >= openMin && min < closeMin;
}

function pauseMinutes(row: PauseRow): number {
  const start = new Date(row.started_at).getTime();
  const dayEnd = new Date(`${row.biz_date}T04:00:00+09:00`).getTime() + 24 * 60 * 60_000;
  const end = row.ended_at ? new Date(row.ended_at).getTime() : Math.min(Date.now(), dayEnd);
  return Math.max(0, Math.round((end - start) / 60_000));
}

/** 席ボードの現在の状態と今日の予約（タブレットが15秒ごとに呼ぶ） */
export async function getBoardSnapshot(): Promise<BoardSnapshot> {
  await requireProfile();
  const date = todayBizDate();
  const supabase = await createClient();

  const FIELDS =
    "id, reference, biz_date, starts_at, party_size, customer_name, seat_note, source, status";
  const monthFrom = `${date.slice(0, 7)}-01`;
  const [boardQ, resvQ, netQ, pauseQ] = await Promise.all([
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
    supabase
      .from("net_pause")
      .select("biz_date, started_at, ended_at")
      .gte("biz_date", monthFrom)
      .lte("biz_date", date),
  ]);

  const board: Record<string, number> = {};
  for (const b of (boardQ.data ?? []) as { key: string; occupied: number }[]) {
    board[b.key] = b.occupied;
  }

  const pauses = (pauseQ.data ?? []) as PauseRow[];
  const open = pauses.find((p) => p.biz_date === date && p.ended_at === null);
  const pause: PauseState = {
    on: !!open,
    since: open?.started_at ?? null,
    today_min: pauses.filter((p) => p.biz_date === date).reduce((a, p) => a + pauseMinutes(p), 0),
    month_min: pauses.reduce((a, p) => a + pauseMinutes(p), 0),
    month_count: pauses.length,
  };

  const day = await getBusinessDay(date);
  return {
    date,
    board,
    reservations: (resvQ.data ?? []) as ResvLite[],
    recent_net: (netQ.data ?? []) as ResvLite[],
    pause,
    open_now: !day.is_closed && isOpenNow(day.open_min, day.close_min),
  };
}

/**
 * ネット予約の受付を止める／再開する。押した時刻は記録として必ず残る。
 * 止められるのは営業中だけ（閉店後に止めて翌日に持ち越す事故を防ぐ）。
 * 再開はいつでもできる——止まったままにしておく理由はないので。
 */
export async function setNetPause(on: boolean): Promise<{ ok: boolean; error?: string }> {
  // 閲覧のみ（viewer）のアカウントでも押せてしまっていた。
  // ネット予約を止めるのは売上に直結するので、予約を書ける人だけに絞る。
  const me = await requireProfile();
  if (!can(me.role, "reservation.write")) return { ok: false, error: "権限がありません。" };
  const date = todayBizDate();
  if (on) {
    const day = await getBusinessDay(date);
    if (day.is_closed || !isOpenNow(day.open_min, day.close_min)) {
      return { ok: false, error: "営業時間中だけ停止できます。" };
    }
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_net_pause", { p_date: date, p_on: on });
  if (error) return { ok: false, error: "切り替えできませんでした。" };
  return { ok: true };
}

/** 席のタップを保存する。卓は0/1・カウンターは使用席数 */
export async function setSeatState(
  key: string,
  value: number,
): Promise<{ ok: boolean; error?: string }> {
  // 席の埋まり具合はネット予約の空席判定に直結する（全部埋めれば予約が止まる）。
  // 閲覧のみのアカウントには触らせない。
  const me = await requireProfile();
  if (!can(me.role, "reservation.write")) return { ok: false, error: "権限がありません。" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_seat_board", {
    p_date: todayBizDate(),
    p_key: key,
    p_value: value,
  });
  if (error) return { ok: false, error: "保存できませんでした。" };
  return { ok: true };
}
