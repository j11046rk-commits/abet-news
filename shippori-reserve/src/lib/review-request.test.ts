/*
 *   node --test "src/lib/review-request.test.ts"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isReviewUrl, pickReviewTargets } from "./review-request.ts";

test("来店した人（会計済・来店中）にだけ送る（キャンセル・無断・記録なしには送らない）", () => {
  const t = pickReviewTargets(
    [
      { id: "1", status: "completed", line_user_id: "U1" },
      { id: "2", status: "cancelled", line_user_id: "U2" },
      { id: "3", status: "no_show", line_user_id: "U3" },
      { id: "4", status: "confirmed", line_user_id: "U4" },
      { id: "5", status: "completed", line_user_id: null },
      { id: "6", status: "seated", line_user_id: "U6" },
    ],
    new Set(),
    new Set(),
  );
  assert.deepEqual(t, [
    { lineUserId: "U1", reservationId: "1" },
    { lineUserId: "U6", reservationId: "6" },
  ]);
});

test("最近送った人・ブロックした人には送らず、同じ人は1回だけ", () => {
  const t = pickReviewTargets(
    [
      { id: "1", status: "completed", line_user_id: "U1" },
      { id: "2", status: "completed", line_user_id: "U2" },
      { id: "3", status: "completed", line_user_id: "U3" },
      { id: "4", status: "completed", line_user_id: "U3" },
    ],
    new Set(["U1"]),
    new Set(["U2"]),
  );
  assert.deepEqual(t, [{ lineUserId: "U3", reservationId: "3" }]);
});

test("口コミ用のリンクだけを受け付ける", () => {
  assert.equal(isReviewUrl("https://g.page/r/CabcDEF123/review"), true);
  assert.equal(isReviewUrl("https://search.google.com/local/writereview?placeid=abc"), true);
  assert.equal(isReviewUrl("https://example.com/"), false);
  assert.equal(isReviewUrl(null), false);
});
