/*
 *   node --test "src/lib/time.test.ts"
 * 営業日の境目（日本時間の朝4時）。衛生管理の「前の営業日を締める」もこれに乗っている。
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { todayBizDate } from "./time.ts";

const at = (iso: string) => {
  mock.timers.enable({ apis: ["Date"], now: new Date(iso) });
  try {
    return todayBizDate();
  } finally {
    mock.timers.reset();
  }
};

test("深夜0〜4時は前の日の営業として扱う", () => {
  assert.equal(at("2026-11-04T23:59:00+09:00"), "2026-11-04");
  assert.equal(at("2026-11-05T00:30:00+09:00"), "2026-11-04");
  assert.equal(at("2026-11-05T03:59:00+09:00"), "2026-11-04");
  assert.equal(at("2026-11-05T04:00:00+09:00"), "2026-11-05");
});

test("サーバーが世界標準時で動いていても日本時間で数える", () => {
  // 日本時間 11/5 9:00 ＝ 世界標準時 11/5 0:00
  assert.equal(at("2026-11-05T00:00:00Z"), "2026-11-05");
  // 日本時間 11/5 2:00 ＝ 世界標準時 11/4 17:00 → 11/4 の営業
  assert.equal(at("2026-11-04T17:00:00Z"), "2026-11-04");
});
