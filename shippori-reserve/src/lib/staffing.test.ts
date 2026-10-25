/*
 * シフトの目安人数の計算を固定する。
 *
 *   node --test "src/lib/staffing.test.ts"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStaffingModel, forecastDay, percentile, type StaffingHistoryDay } from "./staffing.ts";

const day = (key: number, guests: number, booked: number, staff: number): StaffingHistoryDay => ({
  key,
  guests,
  booked,
  staff,
});

test("percentile は線形補間", () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(percentile([10, 20], 0.75), 17.5);
});

test("予約が少ない日は、同じ曜日の過去の客数がそのまま予想になる", () => {
  const h = [day(3, 20, 4, 2), day(3, 24, 6, 3), day(3, 22, 2, 2)];
  const m = buildStaffingModel(h, 10);
  const f = forecastDay(m, 3, 0, 2);
  assert.equal(f?.expected, 22);
});

test("予約が積み上がると「予約＋予約なしの来店」が上回る", () => {
  const h = [day(3, 20, 4, 2), day(3, 24, 6, 3), day(3, 22, 2, 2)];
  const m = buildStaffingModel(h, 10);
  // 予約なしの来店の中央値は 18（16,18,20）
  const f = forecastDay(m, 3, 15, 2);
  assert.equal(f?.expected, 33);
});

test("曜日の日数が足りなければ、平日／金土のまとまりで代用する", () => {
  const h = [day(1, 10, 0, 2), day(3, 20, 0, 2), day(4, 30, 0, 2)];
  const m = buildStaffingModel(h, 10);
  assert.equal(forecastDay(m, 0, 0, 2)?.expected, 20);
  // 金土は1日も無いので目安を出さない
  assert.equal(forecastDay(m, 5, 0, 2), null);
});

test("1人で回せる客数は過去の上位25%点。日数が足りなければ既定値", () => {
  const few = buildStaffingModel([day(3, 20, 0, 2)], 12);
  assert.equal(few.perStaff, 12);
  assert.equal(few.perStaffFromHistory, false);

  // 客数÷人数 = 5,6,...,14（10日）→ 75%点は 11.75
  const h = Array.from({ length: 10 }, (_, i) => day(3, (5 + i) * 2, 0, 2));
  const m = buildStaffingModel(h, 12);
  assert.equal(m.perStaffFromHistory, true);
  assert.equal(m.perStaff, 11.75);
});

test("目安人数は切り上げで、最低人数を下回らない", () => {
  const h = Array.from({ length: 10 }, () => day(6, 40, 10, 4));
  const m = buildStaffingModel(h, 10); // 1人10名
  assert.equal(forecastDay(m, 6, 0, 2)?.recommended, 4);
  const quiet = buildStaffingModel(Array.from({ length: 10 }, () => day(1, 5, 0, 1)), 10);
  assert.equal(forecastDay(quiet, 1, 0, 2)?.recommended, 2);
});
