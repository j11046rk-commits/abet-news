"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import {
  getDailySummary,
  getReservationsByDate,
  getSeatUnits,
  getStayMinutes,
} from "@/lib/queries";
import { can, SOURCES, STATUSES } from "@/lib/constants";
import { computeSeatUsage, EXCLUSIVE_SEAT, NO_SEAT } from "@/lib/seats";
import { minutesToIso } from "@/lib/time";
import type { Reservation, ReservationSource, ReservationStatus } from "@/lib/types";

export type ReservationInput = {
  biz_date: string;
  /** その営業日の 0:00 からの経過分。18:00 = 1080、25:00 = 1500 */
  start_min: number;
  party_size: number;
  customer_name: string;
  customer_kana?: string;
  phone?: string;
  source: ReservationSource | "";
  source_profile_id?: string;
  source_detail?: string;
  seat_note?: string;
  course_id?: string;
  drink_plan?: boolean;
  is_exclusive?: boolean;
  budget_yen?: number | null;
  needs_invoice?: boolean;
  invoice_name?: string;
  allergy?: string;
  memo?: string;
  status?: ReservationStatus;
};

export type ActionResult = { ok: true; id: string } | { ok: false; error: string };

const VALID_SOURCES = SOURCES.map((s) => s.value);
const VALID_STATUSES = STATUSES.map((s) => s.value);

const trim = (v: string | undefined | null) => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/** 画面とDBの両方で同じことを見る。DB側の制約が最後の砦で、ここは早く親切に返すための層。 */
function validate(input: ReservationInput): string | null {
  if (!input.biz_date) return "日付を選んでください。";
  if (!Number.isFinite(input.start_min)) return "時刻を選んでください。";
  if (!Number.isInteger(input.party_size) || input.party_size < 1 || input.party_size > 100) {
    return "人数は1〜100名で入力してください。";
  }
  if (!trim(input.customer_name)) return "お名前を入力してください。";
  if (!input.source || !VALID_SOURCES.includes(input.source as ReservationSource)) {
    return "流入元（どこから来た予約か）を選んでください。";
  }
  if (input.source === "owner_direct" && !input.source_profile_id) {
    return "オーナー直接の場合は、どのオーナー経由かを選んでください。";
  }
  if (input.status && !VALID_STATUSES.includes(input.status)) return "状態が不正です。";
  return null;
}

/**
 * 席の重なりをサーバーでも見る（画面が古いままの保存や同時入力への備え）。
 * 判定はどの日も「1つの席は1晩1組」（店主指定・繁忙日も同じ）。
 * イベント日は席を使わないので見ない。
 */
async function seatConflictError(
  input: ReservationInput,
  excludeId?: string,
): Promise<string | null> {
  const seats = (input.seat_note ?? "")
    .split("＋")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => s !== NO_SEAT && s !== EXCLUSIVE_SEAT);

  const [day, rows, units] = await Promise.all([
    getDailySummary(input.biz_date),
    getReservationsByDate(input.biz_date),
    getSeatUnits(),
  ]);
  if (day.mode === "event") return null;

  const usage = computeSeatUsage(rows, excludeId);

  // 貸切の日はお店ごと押さえてある。あとから席を1つだけ入れられると、
  // 当日その組と貸切のお客様が鉢合わせる——一番やってはいけない形。
  // 貸切をやめる（この予約を編集して外す）のが先。
  if (usage.exclusive) {
    return input.is_exclusive
      ? "この日はすでに貸切のご予約が入っています。"
      : "この日は貸切のご予約が入っています。先に貸切の予約をご確認ください。";
  }
  if (seats.length === 0) return null;

  for (const name of seats) {
    const unit = units.find((u) => u.name === name);
    if (!unit) continue;
    if (unit.is_shared) {
      if (usage.counter_used + input.party_size > unit.capacity) {
        return `カウンターの残りが足りません（残り ${Math.max(0, unit.capacity - usage.counter_used)} 席）。`;
      }
    } else if (usage.taken.includes(name)) {
      return `「${name}」はこの日すでに予約が入っています。`;
    }
  }
  return null;
}

async function toRow(input: ReservationInput) {
  const stay = await getStayMinutes();
  return {
    biz_date: input.biz_date,
    starts_at: minutesToIso(input.biz_date, input.start_min),
    ends_at: minutesToIso(input.biz_date, input.start_min + stay),
    party_size: input.party_size,
    customer_name: input.customer_name.trim(),
    customer_kana: trim(input.customer_kana),
    phone: trim(input.phone),
    source: input.source as ReservationSource,
    source_profile_id: input.source === "owner_direct" ? (input.source_profile_id ?? null) : null,
    source_detail: trim(input.source_detail),
    seat_note: trim(input.seat_note),
    course_id: input.course_id || null,
    drink_plan: input.drink_plan === true,
    is_exclusive: input.is_exclusive === true,
    budget_yen:
      input.budget_yen === null || input.budget_yen === undefined
        ? null
        : Math.max(0, Math.trunc(input.budget_yen)),
    needs_invoice: input.needs_invoice === true,
    invoice_name: trim(input.invoice_name),
    allergy: trim(input.allergy),
    memo: trim(input.memo),
  };
}

export async function createReservation(input: ReservationInput): Promise<ActionResult> {
  const me = await requireProfile();
  if (!can(me.role, "reservation.write")) return { ok: false, error: "権限がありません。" };

  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const conflict = await seatConflictError(input);
  if (conflict) return { ok: false, error: conflict };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .insert({
      ...(await toRow(input)),
      // 電話やオーナー直通は本人と話しているので、いきなり確定にできる。
      status: input.status ?? "confirmed",
      created_by: me.id,
      updated_by: me.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    return { ok: false, error: "登録できませんでした。入力内容をご確認ください。" };
  }

  revalidatePath("/");
  revalidatePath("/reservations");
  revalidatePath("/day/[date]", "page");
  return { ok: true, id: data.id };
}

export async function updateReservation(
  id: string,
  input: ReservationInput,
): Promise<ActionResult> {
  const me = await requireProfile();
  if (!can(me.role, "reservation.write")) return { ok: false, error: "権限がありません。" };

  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const conflict = await seatConflictError(input, id);
  if (conflict) return { ok: false, error: conflict };

  const supabase = await createClient();
  const { error } = await supabase
    .from("reservations")
    .update({ ...(await toRow(input)), updated_by: me.id })
    .eq("id", id);

  if (error) return { ok: false, error: "更新できませんでした。" };

  revalidatePath("/");
  revalidatePath("/reservations");
  revalidatePath(`/reservations/${id}`);
  revalidatePath("/day/[date]", "page");
  return { ok: true, id };
}

/**
 * 状態遷移。キャンセルだけは理由を必ず受け取る。
 * 行は消さない。「言った・言わない」の記録と、あとの分析のために残す。
 */
export async function setReservationStatus(
  id: string,
  status: ReservationStatus,
  cancelReason?: string,
): Promise<ActionResult> {
  const me = await requireProfile();
  if (!can(me.role, "reservation.write")) return { ok: false, error: "権限がありません。" };
  if (!VALID_STATUSES.includes(status)) return { ok: false, error: "状態が不正です。" };

  const reason = trim(cancelReason);
  if (status === "cancelled" && !reason) {
    return { ok: false, error: "キャンセルの理由を入力してください。" };
  }

  /*
   * キャンセルを取り消すときは、席がまだ空いているか見る。
   *
   * 見ていなかった。キャンセルした予約の席は当然そのあと他のお客様に出るので、
   * 「キャンセルを取り消す」を押すと、同じ席を2組が持ったまま当日を迎える。
   * 画面のどこにも警告は出ず、来店して初めて分かる——予約の仕組みとして
   * 一番やってはいけない形。登録と変更では見ているのに、ここだけ抜けていた。
   */
  if (status !== "cancelled" && status !== "no_show") {
    const supabase0 = await createClient();
    const { data: cur } = await supabase0
      .from("reservations")
      .select("biz_date, party_size, seat_note, status, is_exclusive")
      .eq("id", id)
      .maybeSingle<Pick<Reservation, "biz_date" | "party_size" | "seat_note" | "status" | "is_exclusive">>();

    // いま有効な予約の状態を変えるだけなら、席は既に自分のもの。見る必要は無い。
    if (cur && (cur.status === "cancelled" || cur.status === "no_show")) {
      const conflict = await seatConflictError(
        {
          biz_date: cur.biz_date,
          start_min: 0, // 席の判定に時刻は使わない（1つの席は1晩1組）
          party_size: cur.party_size,
          customer_name: "-",
          source: "phone",
          seat_note: cur.seat_note ?? "",
          is_exclusive: cur.is_exclusive,
        },
        id,
      );
      if (conflict) {
        return {
          ok: false,
          error: `${conflict}この予約を戻すには、席を選び直してください。`,
        };
      }
    }
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("reservations")
    .update({
      status,
      cancel_reason: status === "cancelled" ? reason : null,
      updated_by: me.id,
    })
    .eq("id", id);

  if (error) return { ok: false, error: "変更できませんでした。" };

  revalidatePath("/");
  revalidatePath("/reservations");
  revalidatePath(`/reservations/${id}`);
  revalidatePath("/day/[date]", "page");
  return { ok: true, id };
}
