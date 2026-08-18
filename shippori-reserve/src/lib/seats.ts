import type { Reservation, SeatUnit, SeatUsage } from "@/lib/types";

export const NO_SEAT = "指定なし";
export const COUNTER_NAME = "カウンター";
/** 貸切の予約に入れる席メモ。席を1つずつ選ぶ代わりの1語。 */
export const EXCLUSIVE_SEAT = "貸切";

/**
 * その日の席の埋まり具合を予約の一覧から出す。
 *
 * 時間帯の重なりまでは見ない——どの日も「1つの席は1晩1組」として扱う（店主指定・繁忙日も同じ）。
 * 「T1に既に予約がある日は、T1をもう選べない」で十分に事故を防げる。
 * DBレベルの厳密な排他制約は Phase 2。
 */
export function computeSeatUsage(rows: Reservation[], excludeId?: string): SeatUsage {
  const taken: string[] = [];
  let counterUsed = 0;
  let exclusive = false;

  for (const r of rows) {
    if (r.id === excludeId) continue;
    if (r.status === "cancelled" || r.status === "no_show") continue;

    // 貸切はお店ごと押さえる予約。席が1つも選ばれていなくてもその日は全部ふさがる。
    if (r.is_exclusive) exclusive = true;

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

  return { taken, counter_used: counterUsed, exclusive };
}

/** その席が選べないか（カウンターは残席で、専有席は行の有無で見る） */
export function isSeatFull(unit: SeatUnit, usage: SeatUsage, partySize: number): boolean {
  if (usage.exclusive) return true; // 貸切の日は席が1つも残らない
  if (unit.is_shared) return usage.counter_used + partySize > unit.capacity;
  return usage.taken.includes(unit.name);
}

/** 暦の空き状況ストリップに載せる短い名前。カウンター→C、和室→和。 */
export const seatShort = (unit: SeatUnit): string =>
  unit.is_shared ? "C" : unit.name === "和室" ? "和" : unit.name;

/**
 * 予約の席メモ → 表示上の席種（色分け用）。
 * カレンダー・日別で「テーブルの予約」「和室の予約」が一目で分かるようにする。
 */
export function seatKind(seatNote: string | null | undefined): "table" | "room" | "counter" | "" {
  const s = seatNote ?? "";
  if (s.includes("和室")) return "room";
  if (/T[1-9]/.test(s)) return "table";
  if (s.includes(COUNTER_NAME)) return "counter";
  return "";
}

/**
 * 席ボードのキー（'T1' 'T2-3' 'Z1' 'C7' …）を、席マスタの名前に直す。
 * ボードは1席ずつ記録するが、予約が見るのは卓の単位。
 */
export function unitOfSeatKey(key: string): string {
  const table = /^(T\d+)-\d+$/.exec(key);
  if (table) return table[1];
  if (/^Z\d+$/.test(key)) return "和室";
  if (/^C\d*$/.test(key)) return COUNTER_NAME;
  return key; // 旧キー（'T1' '和室'）はそれ自体が卓名
}

export type BoardRow = { key: string; occupied: number };

/**
 * 席ボード（いま実際に座っている席）を読む。
 *
 * ★これは**表示のためだけ**に使う。空き判定には混ぜない。
 *   混ぜて「選べない」にすると、着席済みの予約を直せなくなる——
 *   T1のお客様が着席してボードを点けたあと「1人増えます」で人数を変えようとすると、
 *   埋めているのが本人なのに「T1は埋まっています」で弾かれる。
 *   ボードには予約IDが無いので、自分自身が座っていることを見分けられない。
 *   営業中に人数を直せないほうが、まれな席の取り合いより実害が大きい。
 *
 *   スタッフには真実を見せて、判断は人に残す。
 *   （22時からの予約に、いま座っている卓を当てるのは正しい判断でありうる）
 */
export function boardUsage(rows: BoardRow[]): { seated: string[]; seated_counter: number } {
  const seated: string[] = [];
  const stools = new Set<string>();
  let counterTotal = 0;

  for (const b of rows) {
    if (b.occupied <= 0) continue;
    if (b.key === "C") {
      // 旧方式：使用席数の合計
      counterTotal = Math.max(counterTotal, b.occupied);
    } else if (/^C\d+$/.test(b.key)) {
      stools.add(b.key);
    } else {
      const unit = unitOfSeatKey(b.key);
      if (!seated.includes(unit)) seated.push(unit);
    }
  }
  // 旧'C'（合計）と C1〜C10（1席ずつ）の両方式があるので大きい方を採る
  return { seated, seated_counter: Math.max(counterTotal, stools.size) };
}
