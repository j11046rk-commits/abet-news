/*
 *   node --test "src/lib/store-eval.test.ts"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TARGETS, rankOf, starsAvailable, starsEarned, storeEval, targetsFrom } from "./store-eval.ts";

const base = {
  sales: { actual: 3_300_000, target: 3_000_000 },
  // 人時売上 5,000円（50万円 ÷ 100時間）→ 推定人件費率 25%
  labor: { sales: 500_000, minutes: 6_000 },
  cost: { ratio: 32, span: "11/2〜11/29" },
  targets: { ...DEFAULT_TARGETS, costRatio: 30 },
};

test("3つの達成率と点数", () => {
  const r = storeEval(base);
  const m = Object.fromEntries(r.metrics.map((x) => [x.key, x]));
  assert.equal(m.sales!.rate, 110);
  assert.equal(m.labor!.rate, 100); // 目標25% ÷ 推定25%
  assert.equal(m.cost!.rate, 93.8); // 30 ÷ 32
  // (110×40 + 100×30 + 93.8×30) ÷ 100
  assert.equal(r.score, 102.1);
  assert.equal(r.rank, "A");
});

test("人件費率は人時売上から推定。人時売上が高いほど率は低く、達成率は高い", () => {
  const r = storeEval({ ...base, labor: { sales: 600_000, minutes: 6_000 } }); // 6,000円/時 → 約20.8%
  const m = r.metrics.find((x) => x.key === "labor")!;
  assert.equal(m.rate, 120);
  assert.ok(m.actual.startsWith("20.8%"));
});

test("達成率は120%で頭打ち（1つの物差しだけで点数が跳ねない）", () => {
  const r = storeEval({ ...base, sales: { actual: 6_000_000, target: 3_000_000 }, cost: { ratio: null, span: null } });
  // 売上200%→120で計算。原価は出せないので外して割り直す：(120×40 + 100×30) ÷ 70
  assert.equal(r.score, 111.4);
});

test("出せない物差しは外す。全部出せなければ点数なし", () => {
  const r = storeEval({ sales: { actual: null, target: null }, labor: { sales: 0, minutes: 0 }, cost: { ratio: null, span: null }, targets: DEFAULT_TARGETS });
  assert.equal(r.score, null);
  assert.equal(r.rank, null);
  assert.equal(r.metrics.find((x) => x.key === "cost")!.note, "目標が未設定");
});

test("ランクの区切り", () => {
  assert.deepEqual([105, 104.9, 100, 95, 90, 89.9].map(rankOf), ["S", "A", "A", "B", "C", "D"]);
});

test("目標の読み込み：壊れた値は既定に戻す", () => {
  assert.deepEqual(targetsFrom({}), DEFAULT_TARGETS);
  assert.deepEqual(targetsFrom({ eval_labor_ratio: 28, eval_cost_ratio: "31", eval_hour_cost: 1300 }), { laborRatio: 28, hourCost: 1300, costRatio: 31 });
  assert.deepEqual(targetsFrom({ eval_labor_ratio: 200, eval_cost_ratio: "abc" }), DEFAULT_TARGETS);
});

test("累計の⭐：確定した月の達成日×出勤だけ。使える数は申請中・交換済みを引く", () => {
  const shifts = new Map([
    ["2026-08-01", ["a", "b"]],
    ["2026-08-02", ["a"]],
    ["2026-07-31", ["a"]],
  ]);
  const s = starsEarned(["2026-08-01", "2026-08-02", "2026-07-31", "2026-08-03"], shifts, new Set(["2026-08"]));
  assert.equal(s.get("a"), 2); // 7月は未確定の月なので数えない
  assert.equal(s.get("b"), 1);
  assert.equal(starsAvailable(146, 100, 0), 46);
  assert.equal(starsAvailable(120, 0, 100), 20);
  assert.equal(starsAvailable(50, 100, 0), 0);
});
