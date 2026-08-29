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
import { boardUsage, computeSeatUsage, type BoardRow } from "@/lib/seats";
import type { SalesDay } from "@/lib/sales";
import { monthGrid, monthRange, shiftDate, todayBizDate, weekdayOf } from "@/lib/time";
import type { WeatherRow } from "@/lib/weather";
import type {
  BusinessDay,
  Course,
  DailySummary,
  Profile,
  Reservation,
  SeatUnit,
  SeatUsage,
  ShiftTimeRow,
} from "@/lib/types";

/**
 * 取得に失敗したことを、せめてログに残す。
 *
 * これまでは `const { data } = await ...` と error を捨てていたので、
 * 通信やRLSの失敗が「データが1件も無い」と見分けがつかなかった。
 * 予約の一覧が空なら「今夜は予約ゼロ」に見えるし、売上が空なら
 * 「まだ実績が入っていない」に見える。どちらも嘘になる。
 *
 * 個人情報は出さない（テーブル名とコードだけ）。Vercelのログに残る。
 */
function warnQuery(where: string, error: { code?: string; message?: string } | null): void {
  if (error) console.error("query_failed", where, error.code ?? "?");
}


/** settings テーブルをキーバリューのまま返す（1リクエスト1回） */
export const getSettings = cache(async function getSettings(): Promise<Record<string, unknown>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("key, value");
  warnQuery("getSettings", error);
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
    // 金土は既定で繁忙日（店主指定）。行を保存すれば個別にオフにできる
    is_busy: dow === 5 || dow === 6,
    is_closed: closedWeekdays.includes(dow),
    event_name: null,
    event_capacity: null,
    flyer_url: null,
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
  const { data, error } = await supabase
    .from("business_days")
    .select("*")
    .eq("biz_date", date)
    .maybeSingle<BusinessDay>();
  warnQuery("getBusinessDay", error);

  return data ?? deriveBusinessDay(date, await getSettings());
}

/** その日のサマリー（件数・人数・残定員）。行が無ければ 0 件の日として返す。 */
export async function getDailySummary(date: string): Promise<DailySummary> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_daily_summary")
    .select("*")
    .eq("biz_date", date)
    .maybeSingle<DailySummary>();
  // 空とエラーを取り違えると「今夜は予約ゼロ」に見えてしまう。ここは隠さず投げる。
  if (error) {
    console.error("query_failed", "getDailySummary", error.code ?? "?");
    throw new Error("予約を読み込めませんでした。");
  }

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
  const { data, error } = await supabase
    .from("v_daily_summary")
    .select("*")
    .gte("biz_date", from)
    .lte("biz_date", to)
    .returns<DailySummary[]>();
  warnQuery("getMonthSummaries", error);

  return new Map((data ?? []).map((d) => [d.biz_date, d]));
}

/** 月ぶんの天気（晴・曇・雨）。暦と売上タブのマークが使う。 */
export async function getMonthWeather(ym: string): Promise<Map<string, WeatherRow>> {
  const { from, to } = monthRange(ym);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("weather_daily")
    .select("biz_date, weather, precip_mm, temp_max_c, temp_min_c, is_forecast")
    .gte("biz_date", from)
    .lte("biz_date", to);
  warnQuery("getMonthWeather", error);
  return new Map((data ?? []).map((d) => [d.biz_date as string, d as WeatherRow]));
}

/** その日の天気。日別画面の見出しが使う。 */
export async function getDayWeather(date: string): Promise<WeatherRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("weather_daily")
    .select("biz_date, weather, precip_mm, temp_max_c, temp_min_c, is_forecast")
    .eq("biz_date", date)
    .maybeSingle();
  warnQuery("getDayWeather", error);
  return (data as WeatherRow | null) ?? null;
}

/**
 * 直近3か月（92日）の平均客単価。分子は店内売上（物販除く・店主指示）。
 * 暦の「目安客数」＝目標日商÷この値（店主要望 2026-08-29）が使う。
 */
export async function getRecentPerGuest(): Promise<number | null> {
  const supabase = await createClient();
  const from = shiftDate(todayBizDate(), -92);
  const { data, error } = await supabase
    .from("sales_daily")
    .select("actual_yen, tax8_yen, guest_count")
    .gte("biz_date", from)
    .not("actual_yen", "is", null)
    .gt("guest_count", 0);
  warnQuery("getRecentPerGuest", error);
  let yen = 0;
  let guests = 0;
  for (const r of data ?? []) {
    yen += (r.actual_yen ?? 0) - (r.tax8_yen ?? 0);
    guests += r.guest_count ?? 0;
  }
  return guests > 0 ? yen / guests : null;
}

/**
 * 月ぶんのLINE友だち数（日次スナップショット）。暦が使う。
 * 前日との差を出すため、月初の前日も1日ぶん余分に取る。
 */
export async function getMonthLineFollowers(ym: string): Promise<Map<string, number>> {
  const { from, to } = monthRange(ym);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("line_followers_daily")
    .select("biz_date, followers")
    .gte("biz_date", shiftDate(from, -1))
    .lte("biz_date", to);
  warnQuery("getMonthLineFollowers", error);
  return new Map((data ?? []).map((d) => [d.biz_date as string, d.followers as number]));
}

/** 月ぶんの予約を日付ごとにまとめて返す。暦（月ビュー）が使う。 */
export async function getMonthReservations(ym: string): Promise<Map<string, Reservation[]>> {
  const { from, to } = monthRange(ym);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .gte("biz_date", from)
    .lte("biz_date", to)
    .order("starts_at", { ascending: true })
    .returns<Reservation[]>();
  // 空とエラーを取り違えると「今夜は予約ゼロ」に見えてしまう。ここは隠さず投げる。
  if (error) {
    console.error("query_failed", "getMonthReservations", error.code ?? "?");
    throw new Error("予約を読み込めませんでした。");
  }

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
  return (await getMonthShiftRows(ym)).byDate;
}

/** 月ぶんの確定シフト。誰がどの日に入るかと、その日の時間。 */
export async function getMonthShiftRows(ym: string): Promise<{
  byDate: Map<string, string[]>;
  times: Map<string, ShiftTimeRow>;
}> {
  const { from, to } = monthRange(ym);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shifts")
    .select("biz_date, profile_id, start_min, end_min")
    .gte("biz_date", from)
    .lte("biz_date", to);
  warnQuery("getMonthShiftRows", error);

  const byDate = new Map<string, string[]>();
  const times = new Map<string, ShiftTimeRow>();
  for (const row of data ?? []) {
    const date = row.biz_date as string;
    const pid = row.profile_id as string;
    const list = byDate.get(date);
    if (list) list.push(pid);
    else byDate.set(date, [pid]);
    times.set(`${date}|${pid}`, {
      start_min: (row.start_min as number | null) ?? null,
      end_min: (row.end_min as number | null) ?? null,
    });
  }
  return { byDate, times };
}

/** その日の席の埋まり具合。予約フォームが選択可否の判定に使う。 */
export async function getSeatUsage(date: string, excludeId?: string): Promise<SeatUsage> {
  const [rows, board] = await Promise.all([getReservationsByDate(date), getBoardRows(date)]);
  // 空き判定は予約だけで出す。席ボードは「いま座っている」印として横に添えるだけ——
  // 判定に混ぜると、着席済みの予約を直せなくなる（lib/seats.ts の boardUsage 参照）
  return { ...computeSeatUsage(rows, excludeId), ...boardUsage(board) };
}

/** 席ボードのその日ぶん（タブレットで点けた席）。表示に添えるためだけに読む。 */
async function getBoardRows(date: string): Promise<BoardRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("seat_board")
    .select("key, occupied")
    .eq("biz_date", date);
  warnQuery("getBoardRows", error);
  return (data ?? []) as BoardRow[];
}

/** 月ぶんの売上（日付 → 目標と実績）。カレンダーと売上タブが使う。 */
export async function getMonthSales(ym: string): Promise<Map<string, SalesDay>> {
  const { from, to } = monthRange(ym);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_daily")
    .select("biz_date, target_yen, actual_yen, tax8_yen, tax10_yen, guest_count, check_count")
    .gte("biz_date", from)
    .lte("biz_date", to);
  warnQuery("getMonthSales", error);

  return new Map((data ?? []).map((r) => [r.biz_date as string, r as SalesDay]));
}

/** 月間売上目標（端数なしの正の数字。日毎の合計とは別に持つ） */
export async function getMonthlySalesTarget(ym: string): Promise<number | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_monthly")
    .select("target_yen")
    .eq("ym", ym)
    .maybeSingle<{ target_yen: number }>();
  warnQuery("getMonthlySalesTarget", error);
  return data?.target_yen ?? null;
}

/** 1日ぶんの売上（営業日の設定画面が使う） */
export async function getSalesDay(date: string): Promise<SalesDay | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_daily")
    .select("biz_date, target_yen, actual_yen, tax8_yen, tax10_yen, guest_count, check_count")
    .eq("biz_date", date)
    .maybeSingle<SalesDay>();
  warnQuery("getSalesDay", error);
  return data ?? null;
}

/** 月ぶんの希望シフト（日付 → profile_id の配列）。シフトタブが使う。 */
export async function getMonthShiftRequests(ym: string): Promise<Map<string, string[]>> {
  return (await getMonthShiftRequestRows(ym)).byDate;
}

/**
 * 月ぶんの希望シフト。誰がどの日に入れるかと、その日の時間。
 *
 * 時間は「その日だけ基本と違うとき」にだけ入っている（start_min が null ＝ 基本のとおり）。
 * 判定は lib/shift-time.ts の resolveShiftTime に任せる——ここでは素のまま返す。
 */
export async function getMonthShiftRequestRows(ym: string): Promise<{
  byDate: Map<string, string[]>;
  /** `${date}|${profile_id}` → その日の時間 */
  times: Map<string, ShiftTimeRow>;
}> {
  const { from, to } = monthRange(ym);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shift_requests")
    .select("biz_date, profile_id, start_min, end_min")
    .gte("biz_date", from)
    .lte("biz_date", to);
  warnQuery("getMonthShiftRequestRows", error);

  const byDate = new Map<string, string[]>();
  const times = new Map<string, ShiftTimeRow>();
  for (const row of data ?? []) {
    const date = row.biz_date as string;
    const pid = row.profile_id as string;
    const list = byDate.get(date);
    if (list) list.push(pid);
    else byDate.set(date, [pid]);
    times.set(`${date}|${pid}`, {
      start_min: (row.start_min as number | null) ?? null,
      end_min: (row.end_min as number | null) ?? null,
    });
  }
  return { byDate, times };
}

/** 月の希望提出の記録（profile_id → 提出日時） */
export async function getShiftSubmissions(ym: string): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shift_request_submissions")
    .select("profile_id, submitted_at")
    .eq("ym", ym);
  warnQuery("getShiftSubmissions", error);
  return new Map((data ?? []).map((r) => [r.profile_id as string, r.submitted_at as string]));
}

/** その月のシフトが確定（公開）済みか。確定日時を返す。未確定なら null。 */
export async function getShiftPublication(ym: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shift_publications")
    .select("published_at")
    .eq("ym", ym)
    .maybeSingle<{ published_at: string }>();
  warnQuery("getShiftPublication", error);
  return data?.published_at ?? null;
}

/** その日のシフト（誰が入っているかと、その日の時間） */
export async function getDayShiftRows(date: string): Promise<{
  ids: string[];
  /** profile_id → その日の時間（入っていなければ本人の基本のとおり） */
  times: Record<string, ShiftTimeRow>;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shifts")
    .select("profile_id, start_min, end_min")
    .eq("biz_date", date);
  warnQuery("getDayShiftRows", error);

  const ids: string[] = [];
  const times: Record<string, ShiftTimeRow> = {};
  for (const r of data ?? []) {
    const pid = r.profile_id as string;
    ids.push(pid);
    if ((r.start_min as number | null) != null) {
      times[pid] = {
        start_min: r.start_min as number,
        end_min: (r.end_min as number | null) ?? null,
      };
    }
  }
  return { ids, times };
}

/** その営業日の予約。時刻順。 */
export async function getReservationsByDate(date: string): Promise<Reservation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("biz_date", date)
    .order("starts_at", { ascending: true })
    .returns<Reservation[]>();
  // 空とエラーを取り違えると「今夜は予約ゼロ」に見えてしまう。ここは隠さず投げる。
  if (error) {
    console.error("query_failed", "getReservationsByDate", error.code ?? "?");
    throw new Error("予約を読み込めませんでした。");
  }

  return data ?? [];
}

export type ReservationFilter = {
  from?: string;
  to?: string;
  status?: string;
  source?: string;
  /** 受付した人（created_by）で絞る */
  createdBy?: string;
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
  if (f.createdBy) query = query.eq("created_by", f.createdBy);

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

  const { data, error } = await query
    .order("biz_date", { ascending: !f.desc })
    .order("starts_at", { ascending: !f.desc })
    .limit(300)
    .returns<Reservation[]>();
  warnQuery("searchReservations", error);

  return data ?? [];
}

export async function getReservation(id: string): Promise<Reservation | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("id", id)
    .maybeSingle<Reservation>();
  warnQuery("getReservation", error);

  return data ?? null;
}

/** 流入元「オーナー直接」で選ばせる相手（オーナー3名） */
export const getOwnerContacts = cache(async function getOwnerContacts(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("is_owner_contact", true)
    .eq("is_active", true)
    .order("sort_order")
    .returns<Profile[]>();
  warnQuery("getOwnerContacts", error);

  return data ?? [];
});

export const getCourses = cache(async function getCourses(): Promise<Course[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("courses")
    .select("*")
    .eq("is_active", true)
    .order("sort_order")
    .returns<Course[]>();
  warnQuery("getCourses", error);

  return data ?? [];
});

export const getSeatUnits = cache(async function getSeatUnits(): Promise<SeatUnit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("seat_units")
    .select("*")
    .eq("is_active", true)
    .order("sort_order")
    .returns<SeatUnit[]>();
  warnQuery("getSeatUnits", error);

  return data ?? [];
});

export async function getAllProfiles(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("sort_order")
    .order("login_id")
    .returns<Profile[]>();
  warnQuery("getAllProfiles", error);

  return data ?? [];
}

/** 予約に添える「誰が登録したか」用の名前引き */
export async function getProfileNames(): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id, display_name");
  warnQuery("getProfileNames", error);
  return new Map((data ?? []).map((p) => [p.id as string, p.display_name as string]));
}

/** 年間ページ用：1か月ぶんのまとめ */
export type YearMonth = {
  /** 2026-01 */
  ym: string;
  /** 1〜12 */
  month: number;
  /** 月間目標（未設定なら日次目標の合計、それも無ければ null） */
  target: number | null;
  /** 実績（物販こみ・店主指示で月間は合計で見る） */
  actual: number;
  /** うち物販（消費税8%） */
  retail: number;
  /** 実績が入っている日数。月の途中かどうかの判断に使う */
  days: number;
  /** 客数（エアレジ）。取り込んでいない月は null */
  guests: number | null;
  /** 会計数＝伝票の枚数（おおよその組数）。取り込んでいない月は null */
  checks: number | null;
  /**
   * 客単価の分子。客数が入っている日ぶんの、**物販を除いた**売上。
   *
   * 物販を客単価から抜くのは店主指示（2026-08-18）。太巻きが62万入った日を混ぜると
   * その月の客単価だけ跳ね上がり、店の地力が読めなくなる。
   * 月の一部しか客数が取り込めていない月のために、分子も同じ日ぶんに揃えてある。
   */
  guestActual: number | null;
  /** 前年同月の実績（無ければ null） */
  lastYear: number | null;
  /** 前年同月の客数（無ければ null） */
  lastYearGuests: number | null;
  /** 前年同月の、客数が入っている日ぶんの売上（物販を除く） */
  lastYearGuestActual: number | null;
};

/**
 * 1年ぶんの売上を月ごとにまとめる。
 *
 * 月間の目標と実績は「物販こみの合計」で見る（店主指示 2026-08）。
 * 日毎の画面が店内だけで見ているのと、ここが食い違わないよう
 * lib/sales.ts の salesView と同じ足し方にしてある。
 *
 * 前年同月も一緒に返す。目標が無い年（2024・2025）でも、
 * 前年比だけは出せるので、数字が1本でも並ぶようにする。
 */
export async function getYearSales(year: number): Promise<YearMonth[]> {
  const supabase = await createClient();
  const from = `${year - 1}-01-01`;
  const to = `${year}-12-31`;

  // PostgREST の既定は1000行。2年ぶん（約730行）でも足りるが、
  // 上限に当たると黙って切れるので明示しておく。
  const [dailyQ, monthlyQ] = await Promise.all([
    supabase
      .from("sales_daily")
      .select("biz_date, target_yen, actual_yen, tax8_yen, guest_count, check_count")
      .gte("biz_date", from)
      .lte("biz_date", to)
      .limit(2000),
    supabase.from("sales_monthly").select("ym, target_yen").gte("ym", `${year}-01`).lte("ym", `${year}-12`),
  ]);
  warnQuery("getYearSales.daily", dailyQ.error);
  warnQuery("getYearSales.monthly", monthlyQ.error);

  type Agg = {
    dailyTarget: number;
    actual: number;
    retail: number;
    days: number;
    guests: number;
    checks: number;
    guestActual: number;
    guestRetail: number;
  };
  const agg = new Map<string, Agg>();
  for (const r of dailyQ.data ?? []) {
    const ym = (r.biz_date as string).slice(0, 7);
    const g = agg.get(ym) ?? {
      dailyTarget: 0,
      actual: 0,
      retail: 0,
      days: 0,
      guests: 0,
      checks: 0,
      guestActual: 0,
      guestRetail: 0,
    };
    g.dailyTarget += (r.target_yen as number | null) ?? 0;
    const a = r.actual_yen as number | null;
    if (a != null) {
      g.actual += a;
      g.days += 1;
    }
    g.retail += (r.tax8_yen as number | null) ?? 0;
    const guests = r.guest_count as number | null;
    if (guests != null) {
      g.guests += guests;
      // 客単価の分子は「客数が入っている日の売上」だけ。月の半分しか客数が
      // 取り込めていない月に、月まるごとの売上を客数で割ると倍に見える。
      g.guestActual += a ?? 0;
      // 物販は客単価から抜く（店主指示 2026-08-18）。同じ日ぶんだけ引く
      g.guestRetail += (r.tax8_yen as number | null) ?? 0;
    }
    g.checks += (r.check_count as number | null) ?? 0;
    agg.set(ym, g);
  }

  const monthly = new Map<string, number>(
    (monthlyQ.data ?? []).map((m) => [m.ym as string, m.target_yen as number]),
  );

  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    const prev = `${year - 1}-${String(month).padStart(2, "0")}`;
    const g = agg.get(ym);
    const p = agg.get(prev);
    const target = monthly.get(ym) ?? (g && g.dailyTarget > 0 ? g.dailyTarget : null);
    return {
      ym,
      month,
      target,
      actual: g?.actual ?? 0,
      retail: g?.retail ?? 0,
      days: g?.days ?? 0,
      // 客数は取れていない日がある。0 は「まだ取り込んでいない」なので null にして
      // 割り算に持ち込ませない（0で割った客単価が画面に出るより、—— のほうがよい）
      guests: g && g.guests > 0 ? g.guests : null,
      checks: g && g.checks > 0 ? g.checks : null,
      guestActual: g && g.guests > 0 ? g.guestActual - g.guestRetail : null,
      lastYear: p && p.days > 0 ? p.actual : null,
      lastYearGuests: p && p.guests > 0 ? p.guests : null,
      lastYearGuestActual: p && p.guests > 0 ? p.guestActual - p.guestRetail : null,
    };
  });
}
