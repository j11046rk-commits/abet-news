import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  CLOSED_WEEKDAYS,
  DEFAULT_CLOSE_MIN,
  FRI_SAT_CLOSE_MIN,
  DEFAULT_EVENT_CAPACITY,
  DEFAULT_OPEN_MIN,
  DEFAULT_STAY_MIN,
} from "@/lib/constants";
import { computeSeatUsage, toOccupancies, type SeatOccupancy } from "@/lib/seats";
import type { SalesDay } from "@/lib/sales";
import { monthGrid, monthRange, weekdayOf } from "@/lib/time";
import type {
  BusinessDay,
  Course,
  DailySummary,
  Profile,
  Reservation,
  SeatUnit,
  SeatUsage,
} from "@/lib/types";

/** settings テーブルをキーバリューのまま返す（1リクエスト1回） */
export const getSettings = cache(async function getSettings(): Promise<Record<string, unknown>> {
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("key, value");
  return Object.fromEntries((data ?? []).map((r) => [r.key as string, r.value]));
});

export async function getStayMinutes(): Promise<number> {
  const s = await getSettings();
  const v = Number(s.default_stay_min);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_STAY_MIN;
}

export async function getDefaultEventCapacity(): Promise<number> {
  const s = await getSettings();
  const v = Number(s.default_event_capacity);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_EVENT_CAPACITY;
}

/**
 * business_days に行が無い日を、曜日から組み立てる。
 *
 * 行を持たない日も画面には出る（来月の予定を眺めるだけ、など）。
 * 見るだけで行を作りに行くと、開いただけの日がDBに溜まっていく。
 * だから読むときは導出、書くときに実体化、という分担にする。
 */
export function deriveBusinessDay(
  date: string,
  settings: Record<string, unknown>,
): BusinessDay {
  const dow = weekdayOf(date);
  const closedWeekdays = Array.isArray(settings.closed_weekdays)
    ? (settings.closed_weekdays as number[])
    : CLOSED_WEEKDAYS;

  return {
    biz_date: date,
    mode: "normal",
    is_busy: false,
    is_closed: closedWeekdays.includes(dow),
    event_name: null,
    event_capacity: null,
    open_min: Number(settings.default_open_min) || DEFAULT_OPEN_MIN,
    close_min: dow === 5 || dow === 6 ? FRI_SAT_CLOSE_MIN : DEFAULT_CLOSE_MIN,
    note: null,
    updated_by: null,
    updated_at: new Date(0).toISOString(),
  };
}

/** その日の営業設定。行が無ければ曜日から導出したものを返す。 */
export async function getBusinessDay(date: string): Promise<BusinessDay> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("business_days")
    .select("*")
    .eq("biz_date", date)
    .maybeSingle<BusinessDay>();

  return data ?? deriveBusinessDay(date, await getSettings());
}

/** その日のサマリー（件数・人数・残定員）。行が無ければ 0 件の日として返す。 */
export async function getDailySummary(date: string): Promise<DailySummary> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("v_daily_summary")
    .select("*")
    .eq("biz_date", date)
    .maybeSingle<DailySummary>();

  if (data) return data;

  const day = deriveBusinessDay(date, await getSettings());
  return {
    ...day,
    reservation_count: 0,
    guest_count: 0,
    tentative_count: 0,
    cancelled_count: 0,
    no_show_count: 0,
    remaining_capacity: null,
  };
}

/**
 * カレンダー（S6）が使う。
 * 月グリッドは前後の月にはみ出すので、月の範囲ではなくグリッドの端から端まで取る。
 * そうしないと、月初の週に並ぶ「先月末」のマスだけ予約が0名に見えてしまう。
 */
export async function getMonthSummaries(ym: string): Promise<Map<string, DailySummary>> {
  const grid = monthGrid(ym);
  const from = grid[0];
  const to = grid[grid.length - 1];
  const supabase = await createClient();
  const { data } = await supabase
    .from("v_daily_summary")
    .select("*")
    .gte("biz_date", from)
    .lte("biz_date", to)
    .returns<DailySummary[]>();

  return new Map((data ?? []).map((d) => [d.biz_date, d]));
}

/** 月ぶんの予約を日付ごとにまとめて返す。暦（月ビュー）が使う。 */
export async function getMonthReservations(ym: string): Promise<Map<string, Reservation[]>> {
  const { from, to } = monthRange(ym);
  const supabase = await createClient();
  const { data } = await supabase
    .from("reservations")
    .select("*")
    .gte("biz_date", from)
    .lte("biz_date", to)
    .order("starts_at", { ascending: true })
    .returns<Reservation[]>();

  const map = new Map<string, Reservation[]>();
  for (const r of data ?? []) {
    const list = map.get(r.biz_date);
    if (list) list.push(r);
    else map.set(r.biz_date, [r]);
  }
  return map;
}

/** 月ぶんのシフト（日付 → profile_id の配列） */
export async function getMonthShifts(ym: string): Promise<Map<string, string[]>> {
  const { from, to } = monthRange(ym);
  const supabase = await createClient();
  const { data } = await supabase
    .from("shifts")
    .select("biz_date, profile_id")
    .gte("biz_date", from)
    .lte("biz_date", to);

  const map = new Map<string, string[]>();
  for (const row of data ?? []) {
    const list = map.get(row.biz_date as string);
    if (list) list.push(row.profile_id as string);
    else map.set(row.biz_date as string, [row.profile_id as string]);
  }
  return map;
}

/** その日の席の埋まり具合。予約フォームが選択可否の判定に使う。 */
export async function getSeatUsage(date: string, excludeId?: string): Promise<SeatUsage> {
  return computeSeatUsage(await getReservationsByDate(date), excludeId);
}

/** その日の予約の時間帯一覧（繁忙日の席回転判定に使う） */
export async function getSeatOccupancies(
  date: string,
  excludeId?: string,
): Promise<SeatOccupancy[]> {
  return toOccupancies(await getReservationsByDate(date), excludeId);
}

/** 月ぶんの売上（日付 → 目標と実績）。カレンダーと売上タブが使う。 */
export async function getMonthSales(ym: string): Promise<Map<string, SalesDay>> {
  const { from, to } = monthRange(ym);
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales_daily")
    .select("biz_date, target_yen, actual_yen")
    .gte("biz_date", from)
    .lte("biz_date", to);

  return new Map((data ?? []).map((r) => [r.biz_date as string, r as SalesDay]));
}

/** 1日ぶんの売上（営業日の設定画面が使う） */
export async function getSalesDay(date: string): Promise<SalesDay | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales_daily")
    .select("biz_date, target_yen, actual_yen")
    .eq("biz_date", date)
    .maybeSingle<SalesDay>();
  return data ?? null;
}

/** 月ぶんの希望シフト（日付 → profile_id の配列）。シフトタブが使う。 */
export async function getMonthShiftRequests(ym: string): Promise<Map<string, string[]>> {
  const { from, to } = monthRange(ym);
  const supabase = await createClient();
  const { data } = await supabase
    .from("shift_requests")
    .select("biz_date, profile_id")
    .gte("biz_date", from)
    .lte("biz_date", to);

  const map = new Map<string, string[]>();
  for (const row of data ?? []) {
    const list = map.get(row.biz_date as string);
    if (list) list.push(row.profile_id as string);
    else map.set(row.biz_date as string, [row.profile_id as string]);
  }
  return map;
}

/** 月の希望提出の記録（profile_id → 提出日時） */
export async function getShiftSubmissions(ym: string): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shift_request_submissions")
    .select("profile_id, submitted_at")
    .eq("ym", ym);
  return new Map((data ?? []).map((r) => [r.profile_id as string, r.submitted_at as string]));
}

/** その月のシフトが確定（公開）済みか。確定日時を返す。未確定なら null。 */
export async function getShiftPublication(ym: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shift_publications")
    .select("published_at")
    .eq("ym", ym)
    .maybeSingle<{ published_at: string }>();
  return data?.published_at ?? null;
}

/** その日のシフト（profile_id の配列） */
export async function getShiftProfileIds(date: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("shifts").select("profile_id").eq("biz_date", date);
  return (data ?? []).map((r) => r.profile_id as string);
}

/** その営業日の予約。時刻順。 */
export async function getReservationsByDate(date: string): Promise<Reservation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reservations")
    .select("*")
    .eq("biz_date", date)
    .order("starts_at", { ascending: true })
    .returns<Reservation[]>();

  return data ?? [];
}

export type ReservationFilter = {
  from?: string;
  to?: string;
  status?: string;
  source?: string;
  q?: string;
  desc?: boolean;
};

/** 予約一覧（S3）。日付・状態・流入元・フリーワードで絞る。 */
export async function searchReservations(f: ReservationFilter): Promise<Reservation[]> {
  const supabase = await createClient();
  let query = supabase.from("reservations").select("*");

  if (f.from) query = query.gte("biz_date", f.from);
  if (f.to) query = query.lte("biz_date", f.to);
  if (f.status) query = query.eq("status", f.status);
  if (f.source) query = query.eq("source", f.source);

  if (f.q) {
    // 名前・カナ・電話・受付番号・メモを横断して探す。
    // 「先週LINEで来た鈴木さん」に辿り着ければよい。
    const term = f.q.replace(/[%,()]/g, " ").trim();
    if (term) {
      const like = `%${term}%`;
      query = query.or(
        [
          `customer_name.ilike.${like}`,
          `customer_kana.ilike.${like}`,
          `phone.ilike.${like}`,
          `reference.ilike.${like}`,
          `memo.ilike.${like}`,
        ].join(","),
      );
    }
  }

  const { data } = await query
    .order("biz_date", { ascending: !f.desc })
    .order("starts_at", { ascending: !f.desc })
    .limit(300)
    .returns<Reservation[]>();

  return data ?? [];
}

export async function getReservation(id: string): Promise<Reservation | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reservations")
    .select("*")
    .eq("id", id)
    .maybeSingle<Reservation>();

  return data ?? null;
}

/** 流入元「オーナー直接」で選ばせる相手（オーナー3名） */
export const getOwnerContacts = cache(async function getOwnerContacts(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("is_owner_contact", true)
    .eq("is_active", true)
    .order("sort_order")
    .returns<Profile[]>();

  return data ?? [];
});

export const getCourses = cache(async function getCourses(): Promise<Course[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("courses")
    .select("*")
    .eq("is_active", true)
    .order("sort_order")
    .returns<Course[]>();

  return data ?? [];
});

export const getSeatUnits = cache(async function getSeatUnits(): Promise<SeatUnit[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("seat_units")
    .select("*")
    .eq("is_active", true)
    .order("sort_order")
    .returns<SeatUnit[]>();

  return data ?? [];
});

export async function getAllProfiles(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .order("sort_order")
    .order("login_id")
    .returns<Profile[]>();

  return data ?? [];
}

/** 予約に添える「誰が登録したか」用の名前引き */
export async function getProfileNames(): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, display_name");
  return new Map((data ?? []).map((p) => [p.id as string, p.display_name as string]));
}
