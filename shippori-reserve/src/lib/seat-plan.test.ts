/*
 * カウンターの案内の法則を、店主から聞き取ったとおりに固定する。
 *
 *   node --test "src/lib/seat-plan.test.ts"
 *
 * ここを想像で書くと意味が無い（週次レポートの税率別で一度やってしまった）。
 * 聞き取った答えをそのまま1件ずつテストにしている。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COUNTER_KEYS,
  planCounter,
  planSeats,
  planToBoardState,
  type PlanResv,
  type PlanUnit,
} from "./seat-plan.ts";

const UNITS: PlanUnit[] = [
  { name: "カウンター", is_shared: true, area: "counter", capacity: 10, sort_order: 10 },
  { name: "和室", is_shared: false, area: "private", capacity: 8, sort_order: 20 },
  { name: "T1", is_shared: false, area: "table", capacity: 6, sort_order: 30 },
  { name: "T2", is_shared: false, area: "table", capacity: 6, sort_order: 40 },
  { name: "T3", is_shared: false, area: "table", capacity: 6, sort_order: 50 },
];

let seq = 0;
const r = (party: number, seat = "", opts: Partial<PlanResv> = {}): PlanResv => ({
  id: `r${++seq}`,
  party_size: party,
  seat_note: seat,
  is_exclusive: false,
  starts_at: `2026-08-20T${String(18 + (seq % 4)).padStart(2, "0")}:00:00+09:00`,
  label: `客${seq}`,
  ...opts,
});

// ── 聞き取った法則そのもの ───────────────────────────────────

test("1名は真ん中（3・4・5）", () => {
  assert.deepEqual(planCounter(1, new Set()), [3]);
  assert.deepEqual(planCounter(1, new Set([3])), [4]);
  assert.deepEqual(planCounter(1, new Set([3, 4])), [5]);
});

test("2名は 1・2 が優先、次に 6・7、3組目は 3・4", () => {
  assert.deepEqual(planCounter(2, new Set()), [1, 2]);
  assert.deepEqual(planCounter(2, new Set([1, 2])), [6, 7]);
  assert.deepEqual(planCounter(2, new Set([1, 2, 6, 7])), [3, 4]);
});

test("3名は一角（8・9・10）から。2組目は 1・2・3、3組目は 5・6・7", () => {
  assert.deepEqual(planCounter(3, new Set()), [8, 9, 10]);
  assert.deepEqual(planCounter(3, new Set([8, 9, 10])), [1, 2, 3]);
  assert.deepEqual(planCounter(3, new Set([8, 9, 10, 1, 2, 3])), [5, 6, 7]);
});

test("3名が3組入ると 4 が緩衝として残る", () => {
  const taken = new Set<number>();
  for (const _ of [1, 2, 3]) {
    const got = planCounter(3, taken);
    assert.ok(got);
    got.forEach((n) => taken.add(n));
  }
  assert.deepEqual([...taken].sort((a, b) => a - b), [1, 2, 3, 5, 6, 7, 8, 9, 10]);
});

test("4名以上は10番から下へ", () => {
  assert.deepEqual(planCounter(4, new Set()), [10, 9, 8, 7]);
  assert.deepEqual(planCounter(5, new Set()), [10, 9, 8, 7, 6]);
});

test("10番が埋まっていたら9番から下へ", () => {
  assert.deepEqual(planCounter(4, new Set([10])), [9, 8, 7, 6]);
});

test("入りきらない人数は席を決めない（一部だけ埋めない）", () => {
  assert.equal(planCounter(3, new Set([1, 2, 3, 4, 5, 6, 7, 8, 9])), null);
  assert.equal(planCounter(11, new Set()), null);
});

// ── 席メモの扱い ─────────────────────────────────────────────

test("卓の指定はその卓に、対面で座る", () => {
  const plan = planSeats([r(4, "T1")], UNITS);
  assert.deepEqual([...plan.seats.keys()], ["T1-1", "T1-4", "T1-2", "T1-5"]);
});

test("和室は奥と手前が向かい合う（1と5、2と6…）", () => {
  const plan = planSeats([r(4, "和室")], UNITS);
  assert.deepEqual([...plan.seats.keys()], ["Z1", "Z5", "Z2", "Z6"]);
});

test("カウンター指定は法則で番号が決まる", () => {
  const plan = planSeats([r(3, "カウンター")], UNITS);
  assert.deepEqual([...plan.seats.keys()], ["C8", "C9", "C10"]);
});

test("指定なしの4名以上は、空いているテーブルへ", () => {
  const plan = planSeats([r(4)], UNITS);
  assert.deepEqual([...plan.seats.keys()], ["T1-1", "T1-4", "T1-2", "T1-5"]);
});

test("指定なしの3名以下はカウンターへ", () => {
  const plan = planSeats([r(3)], UNITS);
  assert.deepEqual([...plan.seats.keys()], ["C8", "C9", "C10"]);
});

test("テーブルが全部埋まっていれば、4名以上でもカウンターに10番から", () => {
  // label は通し番号なので当てにしない。予約そのものを掴んで id で照合する。
  const overflow = r(4);
  const plan = planSeats([r(6, "T1"), r(6, "T2"), r(6, "T3"), overflow], UNITS);
  const last = [...plan.seats.entries()].filter(([, v]) => v.id === overflow.id).map(([k]) => k);
  assert.deepEqual(last, ["C10", "C9", "C8", "C7"]);
});

test("席が指定されている予約が、指定なしの予約に席を取られない", () => {
  // 時刻は指定なしのほうが早いが、卓の指定は動かせないので先に置く
  const free = r(5, "", { starts_at: "2026-08-20T18:00:00+09:00" });
  const named = r(6, "T1", { starts_at: "2026-08-20T20:00:00+09:00" });
  const plan = planSeats([free, named], UNITS);
  assert.equal(plan.seats.get("T1-1")?.id, named.id, "T1は指定した組のもの");
  const freeSeats = [...plan.seats.entries()].filter(([, v]) => v.id === free.id).map(([k]) => k);
  assert.deepEqual(freeSeats, ["T2-1", "T2-4", "T2-2", "T2-5", "T2-3"]);
});

test("貸切の日は全席がその予約で埋まる", () => {
  const plan = planSeats([r(30, "貸切", { is_exclusive: true }), r(2, "カウンター")], UNITS);
  assert.equal(plan.seats.size, 10 + 8 + 6 * 3);
  assert.equal(new Set([...plan.seats.values()].map((v) => v.id)).size, 1);
});

test("イベント営業の日は席を割り当てない（定員で見る）", () => {
  const plan = planSeats([r(3), r(8)], UNITS, "event");
  assert.equal(plan.seats.size, 0);
});

test("席が決まらなかった予約は unplanned に残す", () => {
  // カウンター10席・和室・卓3つを埋めたうえで、さらに1組
  const plan = planSeats(
    [r(6, "T1"), r(6, "T2"), r(6, "T3"), r(8, "和室"), r(10, "カウンター"), r(2, "カウンター")],
    UNITS,
  );
  assert.equal(plan.unplanned.length, 1);
  assert.equal(plan.unplanned[0].party_size, 2);
});

// ── ネット予約の空き判定へ渡す形 ────────────────────────────

test("指定なしの予約も、席を埋めたぶんが空き判定に数えられる", () => {
  // これが数えられていなかったので、指定なし3名×3組でもカウンターが10席空いて見えた
  const plan = planSeats([r(3), r(3), r(3)], UNITS);
  const state = planToBoardState(plan, UNITS);
  assert.equal(state.counterUsed, 9);
  assert.deepEqual(state.taken, []);
});

test("卓と和室は卓名で埋まりとして出る", () => {
  const plan = planSeats([r(4, "T2"), r(3, "和室")], UNITS);
  const state = planToBoardState(plan, UNITS);
  assert.deepEqual(state.taken.sort(), ["T2", "和室"]);
  assert.equal(state.counterUsed, 0);
});

test("カウンターのキーは席ボードと同じ形", () => {
  assert.deepEqual(COUNTER_KEYS.slice(0, 3), ["C1", "C2", "C3"]);
  assert.equal(COUNTER_KEYS.at(-1), "C10");
});
