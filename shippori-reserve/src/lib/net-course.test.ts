/*
 *   node --test "src/lib/net-course.test.ts"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { courseBlockReason } from "./net-course.ts";

const c = { min_party: 4, net_until: "2027-01-31" };

test("前日までのご予約に限る（当日は選べない）", () => {
  assert.equal(courseBlockReason(c, "2026-11-03", 4, "2026-11-03"), "前日までのご予約で選べます");
  assert.equal(courseBlockReason(c, "2026-11-04", 4, "2026-11-03"), null);
});

test("4名様から・期間まで", () => {
  assert.equal(courseBlockReason(c, "2026-11-10", 3, "2026-11-03"), "4名様から選べます");
  assert.equal(courseBlockReason(c, "2027-01-31", 4, "2026-11-03"), null);
  assert.equal(courseBlockReason(c, "2027-02-01", 4, "2026-11-03"), "この日は対象外です");
  assert.equal(courseBlockReason(c, null, 4, "2026-11-03"), "日付を選ぶと選べます");
});
