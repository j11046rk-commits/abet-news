import type { Reservation, SeatUnit, SeatUsage } from "@/lib/types";

export const NO_SEAT = "指定なし";
export const COUNTER_NAME = "カウンター";

/**
 * その日の席の埋まり具合を予約の一覧から出す。
 *
 * Phase 1 は時間帯の重なりまで見ない——最終受付が20:30の店なので、1晩1組として扱う。
 * 「T1に既に予約がある日は、T1をもう選べない」で十分に事故を防げる。
 * 時間帯単位の厳密な排他は Phase 2（reservation_seats + DBの排他制約）で入る。
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

/** 暦の空き状況ストリップに載せる短い名前。カウンター→C、和室→和。 */
export const seatShort = (unit: SeatUnit): string =>
  unit.is_shared ? "C" : unit.name === "和室" ? "和" : unit.name;
