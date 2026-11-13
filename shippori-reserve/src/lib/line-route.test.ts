/*
 *   node --test "src/lib/line-route.test.ts"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingRoute, parseBookingTarget } from "./line-route.ts";

const UID = `U${"0123456789abcdef".repeat(2)}`;
const manager = { lineUserId: UID, profileId: "p-manager", name: "ユウト" };

test("設定が無いときは、今までどおりグループへ（促す一文なし）", () => {
  assert.deepEqual(bookingRoute(null, { isFriend: null }), { to: "group", nudge: null });
});

test("友だち追加が済んでいれば個人あて（1通で済む）", () => {
  assert.deepEqual(bookingRoute(manager, { isFriend: true }), { to: "person", lineUserId: UID });
});

test("友だち追加がまだなら黙って捨てず、グループへ送って促す", () => {
  const r = bookingRoute(manager, { isFriend: false });
  assert.equal(r.to, "group");
  assert.match(r.to === "group" ? (r.nudge ?? "") : "", /ユウトさんが「しっぽり亭レポート」を友だち追加/);
});

test("友だちかどうか調べられなかったときは個人あて（6通使うグループへ戻さない）", () => {
  assert.deepEqual(bookingRoute(manager, { isFriend: null }), { to: "person", lineUserId: UID });
});

test("本人が入力した予約は、本人に知らせない。ほかの人が入力したぶんは知らせる", () => {
  assert.deepEqual(bookingRoute(manager, { isFriend: true, actorProfileId: "p-manager" }), { to: "none" });
  assert.deepEqual(bookingRoute(manager, { isFriend: true, actorProfileId: "p-staff" }), { to: "person", lineUserId: UID });
  // 友だち追加がまだでも、本人のぶんをグループへ流さない
  assert.deepEqual(bookingRoute(manager, { isFriend: false, actorProfileId: "p-manager" }), { to: "none" });
});

test("アカウントが分からない設定でも送れる（本人の入力ぶんを見分けないだけ）", () => {
  const t = { ...manager, profileId: null };
  assert.deepEqual(bookingRoute(t, { isFriend: true, actorProfileId: "p-manager" }), { to: "person", lineUserId: UID });
});

test("settings の値：形が合うものだけ受け取る", () => {
  assert.deepEqual(parseBookingTarget({ line_user_id: UID, profile_id: "p-manager", name: "ユウト" }), manager);
  assert.deepEqual(parseBookingTarget({ line_user_id: ` ${UID} ` }), { lineUserId: UID, profileId: null, name: "店長" });
});

test("settings の値：LINEのIDの形でなければ未設定として扱う（グループのIDや空を個人あてに使わない）", () => {
  for (const bad of [null, undefined, "", UID, {}, { line_user_id: "" }, { line_user_id: `C${UID.slice(1)}` }, { line_user_id: "Uabc" }]) {
    assert.equal(parseBookingTarget(bad), null);
  }
});
