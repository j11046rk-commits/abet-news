import { test } from "node:test";
import assert from "node:assert/strict";
import { lineTargetFor } from "./line-kpi";

const MAP = { "2026-08": 44, "2026-09": 102, "2026-12": 286 };

test("lineTargetFor: 表示中の月の目標を返す", () => {
  assert.equal(lineTargetFor(MAP, "2026-08"), 44);
  assert.equal(lineTargetFor(MAP, "2026-09"), 102);
});

test("lineTargetFor: 定義が無い月は直近の過去の月の値", () => {
  assert.equal(lineTargetFor(MAP, "2026-10"), 102); // 10月未定義→9月の値
  assert.equal(lineTargetFor(MAP, "2027-03"), 286); // 未来→最後の値が続く
});

test("lineTargetFor: 最初の定義より前の月は最初の値", () => {
  assert.equal(lineTargetFor(MAP, "2026-07"), 44);
});

test("lineTargetFor: 旧形式(単一の数値)と空はそれなりに", () => {
  assert.equal(lineTargetFor(50, "2026-08"), 50);
  assert.equal(lineTargetFor(undefined, "2026-08"), 0);
  assert.equal(lineTargetFor({}, "2026-08"), 0);
});
