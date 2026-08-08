import { isoToMinutes } from "@/lib/time";
import type { Reservation, SeatUnit, SeatUsage } from "@/lib/types";

export const NO_SEAT = "指定なし";
export const COUNTER_NAME = "カウンター";

/** 予約1件ぶんの席の使い方。繁忙日の時間帯判定に使う最小の形。 */
export type SeatOccupancy = {
  start_min: number;
  party_size: number;
  seats: string[];
};

/**
 * その日の席の埋まり具合を予約の一覧から出す（通常日用）。
 *
 * 通常日は時間帯の重なりまで見ない——1晩1組として扱う。
 * 「T1に既に予約がある日は、T1をもう選べない」で十分に事故を防げる。
 * 繁忙日だけ席の回転を前提に seatUsageAt で時間帯判定する（店主指定）。
 * DBレベルの厳密な排他制約は Phase 2。
 */
export function computeSeatUsage(rows: Reservation[], excludeId?: string): SeatUsage {
  const taken: string[] = [];
  let counterUsed = 0;

  for (const r of rows) {
    if (r.id === excludeId) continue;
    if (r.status === "cancelled" || r.status === "no_show") continue;

    const parts = (r.seat_note ?? "")
      .split("＋")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const p of parts) {
      if (p === NO_SEAT) continue;
      if (p === COUNTER_NAME) counterUsed += r.party_size;
      else if (!taken.includes(p)) taken.push(p);
    }
  }

  return { taken, counter_used: counterUsed };
}

/** その席が選べないか（カウンターは残席で、専有席は行の有無で見る） */
export function isSeatFull(unit: SeatUnit, usage: SeatUsage, partySize: number): boolean {
  if (unit.is_shared) return usage.counter_used + partySize > unit.capacity;
  return usage.taken.includes(unit.name);
}

/** 予約一覧 → 時間帯判定用の一覧（キャンセル・無断・席指定なしは席を塞がない） */
export function toOccupancies(rows: Reservation[], excludeId?: string): SeatOccupancy[] {
  const out: SeatOccupancy[] = [];
  for (const r of rows) {
    if (r.id === excludeId) continue;
    if (r.status === "cancelled" || r.status === "no_show") continue;
    const seats = (r.seat_note ?? "")
      .split("＋")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => s !== NO_SEAT);
    if (seats.length === 0) continue;
    out.push({
      start_min: isoToMinutes(r.biz_date, r.starts_at),
      party_size: r.party_size,
      seats,
    });
  }
  return out;
}

/**
 * 繁忙日の席の埋まり具合：開始時刻に滞在時間（既定2時間）を重ねて、
 * 時間帯がぶつかる予約だけを数える。ずれていれば同じ席をもう1組に出せる。
 * 通常日は computeSeatUsage（1晩1組）のまま。店主指定（2026-08-08 その11）。
 */
export function seatUsageAt(occ: SeatOccupancy[], startMin: number, stayMin: number): SeatUsage {
  const taken: string[] = [];
  let counterUsed = 0;

  for (const o of occ) {
    const overlaps = o.start_min < startMin + stayMin && startMin < o.start_min + stayMin;
    if (!overlaps) continue;
    for (const p of o.seats) {
      if (p === COUNTER_NAME) counterUsed += o.party_size;
      else if (!taken.includes(p)) taken.push(p);
    }
  }

  return { taken, counter_used: counterUsed };
}

/** 暦の空き状況ストリップに載せる短い名前。カウンター→C、和室→和。 */
export const seatShort = (unit: SeatUnit): string =>
  unit.is_shared ? "C" : unit.name === "和室" ? "和" : unit.name;
