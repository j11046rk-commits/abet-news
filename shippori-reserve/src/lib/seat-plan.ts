/*
 * 予約から「どの席に座っていただくか」の下書きを作る。
 *
 * 席ボード（タブレット）を開いた時点で、その日の予約ぶんが埋まっている状態にするため。
 * 開店前に手で並べ直す作業を無くすのが目的。
 *
 * ★これは「下書き」で、正解ではない。
 *   実際にどこに座るかは、当日の流れで必ずズレる。だからボードでは
 *   点線（予約・まだ来ていない）と塗り（着席）を分け、タップで直せるようにする。
 *   ここで決めるのは「何もしなければこうなる」という初期配置だけ。
 *
 * カウンターの案内の法則は店主から聞き取ったもの（2026-08-17）。
 * L字カウンターで、1〜7が長い辺・8〜10が折れた先の一角。
 *
 *   1名     … 3・4・5（真ん中に寄せて、両端と一角を組のために空けておく）
 *   2名     … 1・2 → 6・7 → 3・4（真ん中は最後。先に使うと長い辺が分断される）
 *   3名     … 8・9・10 → 1・2・3 → 5・6・7（一角にまとまって収まる）
 *   4名以上 … 10から下へ（角をまたいで続きの席が取れる）
 *
 * 3名を 1・2・3 と 5・6・7 に置くと 4 が余るが、これは組と組の間の緩衝になる。
 *
 * このファイルは値のimportを持たない（node --test で直に回せるようにするため）。
 */

/** カウンターの丸椅子。席ボードのキーと一致させる */
export const COUNTER_KEYS = Array.from({ length: 10 }, (_, i) => `C${i + 1}`);
/** 和室（掘りごたつ）。1〜4が奥・5〜8が手前 */
export const ROOM_KEYS = Array.from({ length: 8 }, (_, i) => `Z${i + 1}`);
/** テーブルの椅子。T1-1〜T1-6 のように卓名で分かれる。1〜3が片側・4〜6が向かい */
export const tableKeys = (unitName: string, capacity: number): string[] =>
  Array.from({ length: capacity }, (_, i) => `${unitName}-${i + 1}`);

export type PlanUnit = {
  name: string;
  is_shared: boolean;
  area: string | null;
  capacity: number;
  sort_order: number;
};

export type PlanResv = {
  id: string;
  party_size: number;
  /** 席メモ。空文字・「指定なし」は未指定 */
  seat_note: string;
  is_exclusive: boolean;
  /** 並びの決め手。早い予約から希望の席を取る */
  starts_at: string;
  /** 席に出す短い名前（姓など） */
  label: string;
};

export type PlannedSeat = { id: string; label: string };
export type SeatPlan = {
  /** 席のキー → その席に来る予約 */
  seats: Map<string, PlannedSeat>;
  /** 席が決まらなかった予約。画面で「席が決まっていません」と出すため */
  unplanned: PlanResv[];
};

const NO_SEAT = "指定なし";
const COUNTER = "カウンター";
const EXCLUSIVE = "貸切";

/** 人数ごとの案内先。前から順に、全部空いている組を探して当てる */
const COUNTER_BLOCKS: Record<number, number[][]> = {
  1: [[3], [4], [5]],
  2: [
    [1, 2],
    [6, 7],
    [3, 4],
  ],
  3: [
    [8, 9, 10],
    [1, 2, 3],
    [5, 6, 7],
  ],
};

/** 向かい合わせに座る順。1と4、2と5…が対面（和室は1と5、2と6…） */
function facingOrder(capacity: number): number[] {
  const half = Math.ceil(capacity / 2);
  const out: number[] = [];
  for (let i = 1; i <= half; i++) {
    out.push(i);
    if (i + half <= capacity) out.push(i + half);
  }
  return out;
}

/** 10番から下へ、続きの n 席が空いている並びを探す */
function descendingRun(n: number, free: (seat: number) => boolean): number[] | null {
  for (let start = 10; start >= n; start--) {
    const run = Array.from({ length: n }, (_, i) => start - i);
    if (run.every(free)) return run;
  }
  return null;
}

/**
 * カウンターの席番号を決める。決まらなければ null。
 * 中途半端に一部だけ埋めることはしない——2席しか取れない3名組を
 * 座らせた形にすると、画面が嘘になる。
 */
export function planCounter(party: number, taken: ReadonlySet<number>): number[] | null {
  if (party < 1) return null;
  const free = (s: number) => s >= 1 && s <= 10 && !taken.has(s);

  for (const block of COUNTER_BLOCKS[party] ?? []) {
    if (block.every(free)) return block;
  }
  const run = descendingRun(party, free);
  if (run) return run;

  // 続きで取れないときは、空いている席を拾い集める（隣同士にはならない）
  const scattered = COUNTER_KEYS.map((_, i) => i + 1).filter(free);
  return scattered.length >= party ? scattered.slice(0, party) : null;
}

const isUnassigned = (note: string): boolean => {
  const t = (note ?? "").trim();
  return t === "" || t === NO_SEAT;
};

/** 席メモに書かれた卓名を取り出す（「T1＋T2」→ ["T1","T2"]） */
const namedUnits = (note: string): string[] =>
  (note ?? "")
    .split("＋")
    .map((s) => s.trim())
    .filter((s) => s !== "" && s !== NO_SEAT && s !== EXCLUSIVE);

/**
 * その日の予約から席の下書きを作る。
 *
 * イベント営業の日は席を使わない（定員で見る）ので、何も割り当てない。
 * 貸切の日はお店ごと押さえるので、全席をその予約で埋める。
 */
export function planSeats(
  resv: readonly PlanResv[],
  units: readonly PlanUnit[],
  mode: "normal" | "event" = "normal",
  /**
   * いま実際に座っている（席ボードで点灯中の）席のキー。
   * ここを埋まり扱いにしないと、着席した組を下書きから外した瞬間、
   * 次の組の点線が点灯中の席へ再配置される——点灯席には点線が描かれないので、
   * まだ来ていない組がフロア図から消え、受入可の人数も過大になる。
   */
  occupied: ReadonlySet<string> = new Set(),
): SeatPlan {
  const seats = new Map<string, PlannedSeat>();
  const unplanned: PlanResv[] = [];
  if (mode === "event") return { seats, unplanned };

  const counter = units.find((u) => u.is_shared);
  const tables = units
    .filter((u) => !u.is_shared && u.area === "table")
    .sort((a, b) => a.sort_order - b.sort_order);

  const keysOfUnit = (u: PlanUnit): string[] =>
    u.is_shared ? COUNTER_KEYS : u.area === "table" ? tableKeys(u.name, u.capacity) : ROOM_KEYS;

  // 貸切があればその日はお店ごと。ほかを並べる意味がない。
  const exclusive = resv.find((r) => r.is_exclusive);
  if (exclusive) {
    for (const u of units) {
      for (const k of keysOfUnit(u)) seats.set(k, { id: exclusive.id, label: exclusive.label });
    }
    return { seats, unplanned };
  }

  const byTime = [...resv].sort(
    (a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id),
  );

  /** 卓・和室に、対面になる順で人数ぶん座らせる */
  const fillUnit = (u: PlanUnit, r: PlanResv): boolean => {
    const keys = keysOfUnit(u);
    const order = facingOrder(u.capacity);
    const free = order.map((n) => keys[n - 1]).filter((k) => k && !seats.has(k) && !occupied.has(k));
    if (free.length === 0) return false;
    // 卓は1晩1組なので、人数が定員を超えていても取れるだけ座らせる
    for (const k of free.slice(0, Math.min(r.party_size, free.length))) {
      seats.set(k, { id: r.id, label: r.label });
    }
    return true;
  };

  const counterTaken = (): Set<number> => {
    const t = new Set<number>();
    COUNTER_KEYS.forEach((k, i) => {
      if (seats.has(k) || occupied.has(k)) t.add(i + 1);
    });
    return t;
  };

  const seatOnCounter = (r: PlanResv): boolean => {
    if (!counter) return false;
    const nums = planCounter(r.party_size, counterTaken());
    if (!nums) return false;
    for (const n of nums) seats.set(COUNTER_KEYS[n - 1], { id: r.id, label: r.label });
    return true;
  };

  // ① 席が指定されている予約（卓・和室）。動かせないので先に置く。
  const laterCounter: PlanResv[] = [];
  const laterFree: PlanResv[] = [];
  for (const r of byTime) {
    if (isUnassigned(r.seat_note)) {
      laterFree.push(r);
      continue;
    }
    const named = namedUnits(r.seat_note);
    if (named.length === 1 && named[0] === COUNTER) {
      laterCounter.push(r);
      continue;
    }
    let placed = false;
    for (const name of named) {
      const u = units.find((x) => x.name === name);
      if (!u) continue;
      if (u.is_shared) {
        laterCounter.push(r);
        placed = true;
        continue;
      }
      if (fillUnit(u, r)) placed = true;
    }
    if (!placed) unplanned.push(r);
  }

  // ② カウンター指定。番号は法則で決める。
  for (const r of laterCounter) {
    if (!seatOnCounter(r)) unplanned.push(r);
  }

  // ③ 未指定。4名以上はテーブルが空いていればテーブル、なければカウンター。
  //    3名以下はカウンター（店主指定）。
  for (const r of laterFree) {
    if (r.party_size >= 4) {
      const emptyTable = tables.find((u) => tableKeys(u.name, u.capacity).every((k) => !seats.has(k)));
      if (emptyTable && fillUnit(emptyTable, r)) continue;
    }
    // 和室（個室掘りごたつ）には勝手に入れない。指定して取るお席なので、
    // 下書きが埋めてしまうと「空いていないように見える」だけの害になる。
    // テーブルが無ければカウンター、そこも無理なら席を決めずに残す。
    if (!seatOnCounter(r)) unplanned.push(r);
  }

  return { seats, unplanned };
}

/**
 * 下書きを「ネット予約の空き判定」が使う形にまとめる。
 *
 * ★ここが二重予約を防いでいる。
 *   席メモが「指定なし」の予約は、これまで空き判定に一切数えられていなかった
 *   （computeSeatUsage は指定なしを読み飛ばす）。3名の指定なし予約が3組入っていても、
 *   ネット予約からはカウンターが10席空いて見えていた。
 *   下書きで実際の席まで決めてしまえば、そのまま埋まりとして数えられる。
 */
export function planToBoardState(
  plan: SeatPlan,
  units: readonly PlanUnit[],
): { taken: string[]; counterUsed: number } {
  const taken: string[] = [];
  let counterUsed = 0;
  for (const k of plan.seats.keys()) {
    if (/^C\d+$/.test(k)) {
      counterUsed++;
      continue;
    }
    const unit = /^Z\d+$/.test(k)
      ? (units.find((u) => !u.is_shared && u.area !== "table")?.name ?? "和室")
      : k.split("-")[0];
    if (!taken.includes(unit)) taken.push(unit);
  }
  return { taken, counterUsed };
}
