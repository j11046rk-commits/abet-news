import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  CLOSED_WEEKDAYS,
  DEFAULT_CLOSE_MIN,
  DEFAULT_EVENT_CAPACITY,
  DEFAULT_OPEN_MIN,
  DEFAULT_STAY_MIN,
  FRI_SAT_CLOSE_MIN,
} from "@/lib/constants";
import { computeSeatUsage, COUNTER_NAME, NO_SEAT } from "@/lib/seats";
import { minutesToIso, nowJst, shiftDate, todayBizDate, weekdayOf } from "@/lib/time";
import type { BusinessMode, Reservation, SeatUnit } from "@/lib/types";

/**
 * ネット予約（HPの公開フォーム）の空席計算と登録。
 *
 * 空席の判定は店内アプリと完全に同じ物差し：
 *   - 通常営業は「1つの席は1晩1組」・カウンターは残席数
 *   - イベント営業は席を持たず定員（総受け入れ人数）
 * 最後の砦は DB 関数 net_reserve（advisory lock + 再判定 + 登録が1トランザクション）。
 *
 * ここはログイン不要の入り口なので、受け付ける範囲を明確に絞る：
 *   〜8名・当日は2時間前まで・60日先まで。9名以上と直前はお電話へ誘導する。
 */
export const NET = {
  maxParty: 8,
  minLeadMin: 120, // 開始の2時間前まで
  maxDaysAhead: 60,
  slotStep: 30,
  counterMaxParty: 4, // ネットからの自動割当でカウンターに座らせる上限
} as const;

export type NetDayStatus = "ok" | "few" | "full" | "closed" | "out";

type DayRow = {
  biz_date: string;
  mode: BusinessMode;
  is_busy: boolean;
  is_closed: boolean;
  event_name: string | null;
  event_capacity: number | null;
  open_min: number;
  close_min: number;
};

type ResvRow = Pick<Reservation, "id" | "biz_date" | "party_size" | "status" | "seat_note">;

const activeStatuses = ["tentative", "confirmed", "seated"] as const;

function deriveDay(date: string, settings: Record<string, unknown>): DayRow {
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
  };
}

async function fetchRange(from: string, to: string) {
  const admin = createAdminClient();
  const [settingsQ, daysQ, resvQ, unitsQ] = await Promise.all([
    admin.from("settings").select("key, value"),
    admin.from("business_days").select("*").gte("biz_date", from).lte("biz_date", to),
    admin
      .from("reservations")
      .select("id, biz_date, party_size, status, seat_note")
      .gte("biz_date", from)
      .lte("biz_date", to)
      .in("status", [...activeStatuses]),
    admin.from("seat_units").select("*").eq("is_active", true).order("sort_order"),
  ]);

  const settings = Object.fromEntries(
    (settingsQ.data ?? []).map((r) => [r.key as string, r.value]),
  ) as Record<string, unknown>;
  const days = new Map<string, DayRow>((daysQ.data ?? []).map((d) => [d.biz_date as string, d as DayRow]));
  const resv = new Map<string, ResvRow[]>();
  for (const r of (resvQ.data ?? []) as ResvRow[]) {
    const list = resv.get(r.biz_date) ?? [];
    list.push(r);
    resv.set(r.biz_date, list);
  }
  const stayRaw = Number(settings.default_stay_min);
  return {
    settings,
    days,
    resv,
    units: (unitsQ.data ?? []) as SeatUnit[],
    stay: Number.isFinite(stayRaw) && stayRaw > 0 ? stayRaw : DEFAULT_STAY_MIN,
  };
}

/**
 * その晩に party 名を通せる席の候補を、店の好みの順で返す。
 * 1〜2名はカウンター優先。繁忙日は3名以下もカウンター優先（店の運用と同じ）。
 * 3名以上はぴったりに近いテーブル→和室。テーブルが全滅なら4名まではカウンターに逃がす。
 */
export function seatCandidates(
  day: Pick<DayRow, "is_busy">,
  rows: ResvRow[],
  units: SeatUnit[],
  party: number,
): string[] {
  const usage = computeSeatUsage(rows as Reservation[]);
  const counter = units.find((u) => u.is_shared);
  const counterOk =
    counter !== undefined &&
    party <= NET.counterMaxParty &&
    usage.counter_used + party <= counter.capacity;

  const tables = units
    .filter((u) => !u.is_shared && u.capacity >= party && !usage.taken.includes(u.name))
    .sort((a, b) => a.capacity - b.capacity || a.sort_order - b.sort_order)
    .map((u) => u.name);

  const preferCounter = party <= 2 || (day.is_busy && party <= 3);
  const out: string[] = [];
  if (counterOk && preferCounter) out.push(COUNTER_NAME);
  out.push(...tables);
  if (counterOk && !preferCounter) out.push(COUNTER_NAME);
  return out;
}

/** 営業日の枠（30分刻み・滞在時間ぶん手前まで） */
export function slotMinutes(openMin: number, closeMin: number, stay: number): number[] {
  const out: number[] = [];
  for (let m = openMin; m + Math.min(stay, 120) <= closeMin; m += NET.slotStep) out.push(m);
  return out;
}

/** この枠は「今から2時間後」より先か（当日の直前予約を締める） */
function slotLeadOk(date: string, min: number): boolean {
  const slotAt = new Date(minutesToIso(date, min)).getTime();
  return slotAt >= nowJst().getTime() + NET.minLeadMin * 60_000;
}

function dayCore(date: string, ctx: Awaited<ReturnType<typeof fetchRange>>) {
  const day = ctx.days.get(date) ?? deriveDay(date, ctx.settings);
  const rows = ctx.resv.get(date) ?? [];
  return { day, rows };
}

function dayStatus(
  date: string,
  ctx: Awaited<ReturnType<typeof fetchRange>>,
  party: number,
): NetDayStatus {
  const today = todayBizDate();
  if (date < today || date > shiftDate(today, NET.maxDaysAhead)) return "out";

  const { day, rows } = dayCore(date, ctx);
  if (day.is_closed) return "closed";

  // その日の枠が1つでも「2時間前ルール」を満たすか（未来日は常に満たす）
  const slots = slotMinutes(day.open_min, day.close_min, ctx.stay);
  if (!slots.some((m) => slotLeadOk(date, m))) return "full";

  if (day.mode === "event") {
    const cap = day.event_capacity ?? DEFAULT_EVENT_CAPACITY;
    const guests = rows.reduce((a, r) => a + r.party_size, 0);
    if (guests + party > cap) return "full";
    return cap - guests - party < 8 ? "few" : "ok";
  }

  const cands = seatCandidates(day, rows, ctx.units, party);
  if (cands.length === 0) return "full";
  return cands.length === 1 ? "few" : "ok";
}

/** 予約ページのカレンダー用：月内の各日を ◯／残りわずか／×／休 で返す */
export async function monthAvailability(ym: string, party: number) {
  const today = todayBizDate();
  const first = `${ym}-01`;
  const last = shiftDate(`${ym}-01`, 40).slice(0, 8) + "01"; // 翌月1日
  const from = first < today ? today : first;
  const to = shiftDate(last, -1);
  const ctx = await fetchRange(from < to ? from : to, to);

  const out: { date: string; status: NetDayStatus }[] = [];
  for (let d = first; d < last; d = shiftDate(d, 1)) {
    out.push({
      date: d,
      status: d < from || d > to ? "out" : dayStatus(d, ctx, party),
    });
  }
  return out;
}

/** 予約ページの時間選択用：その日の枠一覧 */
export async function dayAvailability(date: string, party: number) {
  const ctx = await fetchRange(date, date);
  const { day, rows } = dayCore(date, ctx);
  const status = dayStatus(date, ctx, party);

  const slots = slotMinutes(day.open_min, day.close_min, ctx.stay).map((m) => ({
    min: m,
    ok: status === "ok" || status === "few" ? slotLeadOk(date, m) : false,
  }));

  return {
    date,
    status,
    is_event: day.mode === "event",
    event_name: day.event_name,
    slots,
  };
}

export type NetBookingInput = {
  date: string;
  start_min: number;
  party: number;
  name: string;
  kana?: string;
  phone: string;
  memo?: string;
  /** ハニーポット。人間には見えない欄。埋まっていたらボット */
  website?: string;
};

export type NetBookingResult =
  | { ok: true; reference: string; seat_note: string }
  | { ok: false; error: string; code?: "RETRY" | "REJECT" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizePhone(raw: string): string | null {
  const digits = (raw ?? "").replace(/[^0-9]/g, "");
  return digits.length >= 10 && digits.length <= 11 ? digits : null;
}

export async function createNetReservation(input: NetBookingInput): Promise<NetBookingResult> {
  if ((input.website ?? "") !== "") {
    // ボットには成功したふりをして時間を無駄にさせない
    return { ok: true, reference: "R-0000-0000", seat_note: NO_SEAT };
  }

  const name = (input.name ?? "").trim();
  const kana = (input.kana ?? "").trim();
  const memo = (input.memo ?? "").trim();
  const phone = normalizePhone(input.phone ?? "");
  const party = input.party;

  if (!DATE_RE.test(input.date ?? "")) return { ok: false, error: "日付が不正です。" };
  if (!Number.isInteger(party) || party < 1) return { ok: false, error: "人数を選んでください。" };
  if (party > NET.maxParty) {
    return { ok: false, error: "9名様以上のご予約はお電話で承ります。", code: "REJECT" };
  }
  if (!name) return { ok: false, error: "お名前を入力してください。" };
  if (name.length > 40 || kana.length > 40) return { ok: false, error: "お名前が長すぎます。" };
  if (!phone) return { ok: false, error: "電話番号を正しく入力してください（10〜11桁）。" };
  if (memo.length > 200) return { ok: false, error: "ご要望は200文字以内でお願いします。" };
  if (!Number.isInteger(input.start_min)) return { ok: false, error: "時間を選んでください。" };

  const today = todayBizDate();
  if (input.date < today) return { ok: false, error: "過去の日付は選べません。" };
  if (input.date > shiftDate(today, NET.maxDaysAhead)) {
    return { ok: false, error: `ご予約は${NET.maxDaysAhead}日先まで承っています。` };
  }

  const admin = createAdminClient();

  // 同じ電話番号の乱発を抑える（今後の営業日に3件まで）
  const { data: samePhone } = await admin
    .from("reservations")
    .select("id")
    .eq("source", "web_form")
    .in("status", [...activeStatuses])
    .gte("biz_date", today)
    .eq("phone", phone)
    .limit(3);
  if ((samePhone ?? []).length >= 3) {
    return {
      ok: false,
      error: "同じ電話番号でのご予約が上限に達しています。変更はお電話でお願いします。",
      code: "REJECT",
    };
  }

  const ctx = await fetchRange(input.date, input.date);
  const { day, rows } = dayCore(input.date, ctx);

  if (day.is_closed) return { ok: false, error: "この日は定休日です。", code: "RETRY" };
  const slots = slotMinutes(day.open_min, day.close_min, ctx.stay);
  if (!slots.includes(input.start_min)) return { ok: false, error: "時間を選び直してください。", code: "RETRY" };
  if (!slotLeadOk(input.date, input.start_min)) {
    return {
      ok: false,
      error: "直前のご予約はネットでは承れません（2時間前まで）。お電話ください。",
      code: "RETRY",
    };
  }

  let seatNote = NO_SEAT;
  if (day.mode === "event") {
    const cap = day.event_capacity ?? DEFAULT_EVENT_CAPACITY;
    const guests = rows.reduce((a, r) => a + r.party_size, 0);
    if (guests + party > cap) return { ok: false, error: "満席です。", code: "RETRY" };
  } else {
    const cands = seatCandidates(day, rows, ctx.units, party);
    if (cands.length === 0) {
      return { ok: false, error: "この日は満席です。別の日をご検討ください。", code: "RETRY" };
    }
    seatNote = cands[0];
  }

  const { data, error } = await admin.rpc("net_reserve", {
    p_date: input.date,
    p_starts_at: minutesToIso(input.date, input.start_min),
    p_ends_at: minutesToIso(input.date, input.start_min + ctx.stay),
    p_party: party,
    p_name: name,
    p_kana: kana || null,
    p_phone: phone,
    p_memo: memo || null,
    p_seat_note: seatNote,
  });

  if (error) {
    // 押した瞬間に他の人が取ったケース。最新の空きで選び直してもらう
    if (/NET_FULL|NET_CLOSED/.test(error.message)) {
      return {
        ok: false,
        error: "申し訳ありません、たった今この枠が埋まりました。別の日時をお選びください。",
        code: "RETRY",
      };
    }
    return { ok: false, error: "予約を確定できませんでした。お電話でお問い合わせください。" };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.reference) {
    return { ok: false, error: "予約を確定できませんでした。お電話でお問い合わせください。" };
  }
  return { ok: true, reference: row.reference as string, seat_note: seatNote };
}

export type NetCancelResult = { ok: true } | { ok: false; error: string };

export async function cancelNetReservation(
  referenceRaw: string,
  phoneRaw: string,
): Promise<NetCancelResult> {
  const reference = (referenceRaw ?? "").trim().toUpperCase().replace(/\s/g, "");
  const phone = normalizePhone(phoneRaw ?? "");
  if (!/^R-\d{4}-\d{4}$/.test(reference)) {
    return { ok: false, error: "予約番号の形式が違います（例：R-2608-0038）。" };
  }
  if (!phone) return { ok: false, error: "電話番号を正しく入力してください。" };

  const admin = createAdminClient();
  const { data: r } = await admin
    .from("reservations")
    .select("id, biz_date, starts_at, status, phone, source")
    .eq("reference", reference)
    .maybeSingle<Pick<Reservation, "id" | "biz_date" | "starts_at" | "status" | "phone" | "source">>();

  // 見つからない場合も番号と電話の不一致も、同じ言い方で返す（総当たり対策）
  const mismatch = { ok: false as const, error: "予約が見つかりません。番号と電話番号をご確認ください。" };
  if (!r || !r.phone || normalizePhone(r.phone) !== phone) return mismatch;

  if (r.status === "cancelled") return { ok: false, error: "この予約はすでにキャンセル済みです。" };
  if (r.status !== "tentative" && r.status !== "confirmed") {
    return { ok: false, error: "この予約はWebからは変更できません。お電話でご連絡ください。" };
  }
  if (new Date(r.starts_at).getTime() < nowJst().getTime() + NET.minLeadMin * 60_000) {
    return { ok: false, error: "開始2時間前を過ぎたキャンセルはお電話でお願いします。" };
  }

  const { error } = await admin
    .from("reservations")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: "お客様によるWebキャンセル",
    })
    .eq("id", r.id)
    .in("status", ["tentative", "confirmed"]);

  if (error) return { ok: false, error: "キャンセルできませんでした。お電話でご連絡ください。" };
  return { ok: true };
}
