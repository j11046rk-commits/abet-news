/*
 *   node --test "src/lib/store-eval.test.ts"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TARGETS, laborCostFor, rankOf, starsAvailable, starsEarned, storeEval, targetsFrom } from "./store-eval.ts";

const base = {
  sales: { actual: 3_300_000, target: 3_000_000 },
  // 人件費 75万円 ÷ 税抜売上 300万円 ＝ 25%
  labor: { cost: 750_000, salesEx: 3_000_000, estimated: false, basis: null },
  cost: { ratio: 32, span: "11/2〜11/29" },
  targets: { ...DEFAULT_TARGETS, costRatio: 30 },
};

test("3つの達成率と点数", () => {
  const r = storeEval(base);
  const m = Object.fromEntries(r.metrics.map((x) => [x.key, x]));
  assert.equal(m.sales!.rate, 110);
  assert.equal(m.labor!.rate, 100); // 目標25% ÷ 実際25%
  assert.equal(m.labor!.actual, "25%");
  assert.equal(m.labor!.note, "月の人件費の合計から");
  assert.equal(m.cost!.rate, 93.8); // 30 ÷ 32
  // (110×40 + 100×30 + 93.8×30) ÷ 100
  assert.equal(r.score, 102.1);
  assert.equal(r.rank, "A");
});

test("人件費率：実績の合計が無い月は、直近の実績の時間単価×労働時間で推定", () => {
  // 10月の実績：62万円 ÷ 500時間 ＝ 1,240円/時。11月は200時間 → 248,000円
  const est = laborCostFor({ actualTotal: null, minutes: 200 * 60, calib: { ym: "2026-10", total: 620_000, minutes: 500 * 60 }, fallbackHourCost: 1250 });
  assert.equal(est.cost, 248_000);
  assert.equal(est.estimated, true);
  assert.ok(est.basis!.startsWith("10月の実績 1時間あたり1,240円"));
  // 実績が1つも無ければ設定の目安
  assert.equal(laborCostFor({ actualTotal: null, minutes: 60, calib: null, fallbackHourCost: 1250 }).cost, 1250);
  // 実績があればそのまま
  assert.deepEqual(laborCostFor({ actualTotal: 700_000, minutes: 1, calib: null, fallbackHourCost: 1250 }), { cost: 700_000, estimated: false, basis: null });

  const r = storeEval({ ...base, labor: { ...est, salesEx: 1_000_000 } });
  const m = r.metrics.find((x) => x.key === "labor")!;
  assert.equal(m.actual, "24.8%（推定）");
  assert.equal(m.rate, 100.8);
});

test("達成率は120%で頭打ち（1つの物差しだけで点数が跳ねない）", () => {
  const r = storeEval({ ...base, sales: { actual: 6_000_000, target: 3_000_000 }, cost: { ratio: null, span: null } });
  // 売上200%→120で計算。原価は出せないので外して割り直す：(120×40 + 100×30) ÷ 70
  assert.equal(r.score, 111.4);
});

test("出せない物差しは外す。全部出せなければ点数なし", () => {
  const r = storeEval({ sales: { actual: null, target: null }, labor: { cost: null, salesEx: null, estimated: true, basis: null }, cost: { ratio: null, span: null }, targets: DEFAULT_TARGETS });
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
