import { test } from "node:test";
import assert from "node:assert/strict";
import { lineDailyGoal, lineMonthPlan } from "./line-kpi.ts";

test("lineDailyGoal: 平日+2・金土+3・休業日0", () => {
  assert.equal(lineDailyGoal(1, false), 2); // 月
  assert.equal(lineDailyGoal(5, false), 3); // 金
  assert.equal(lineDailyGoal(6, false), 3); // 土
  assert.equal(lineDailyGoal(0, false), 2); // 日
  assert.equal(lineDailyGoal(2, true), 0);  // 火(定休)
  assert.equal(lineDailyGoal(5, true), 0);  // 臨時休業の金曜
});

// 2026-10-01(木)〜10-07(水)。火曜は定休
const WEEK = [
  { date: "2026-10-01", dow: 4, isClosed: false },
  { date: "2026-10-02", dow: 5, isClosed: false },
  { date: "2026-10-03", dow: 6, isClosed: false },
  { date: "2026-10-04", dow: 0, isClosed: false },
  { date: "2026-10-05", dow: 1, isClosed: false },
  { date: "2026-10-06", dow: 2, isClosed: true },
  { date: "2026-10-07", dow: 3, isClosed: false },
];

test("lineMonthPlan: 月の目標は日々の目標の合計（休業日は0）", () => {
  const p = lineMonthPlan(WEEK, "2026-10-07");
  assert.equal(p.monthGoal, 2 + 3 + 3 + 2 + 2 + 0 + 2);
  assert.equal(p.goalToDate, p.monthGoal);
});

test("lineMonthPlan: 今日までのペース目標は今日を含めて積む", () => {
  const p = lineMonthPlan(WEEK, "2026-10-03");
  assert.equal(p.goalToDate, 2 + 3 + 3);
  assert.equal(p.monthGoal, 14);
});

test("lineMonthPlan: 過去の月は全日、未来の月は0がペース目標", () => {
  assert.equal(lineMonthPlan(WEEK, "2026-11-15").goalToDate, 14);
  assert.equal(lineMonthPlan(WEEK, "2026-09-20").goalToDate, 0);
});
