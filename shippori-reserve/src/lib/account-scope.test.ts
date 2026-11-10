/*
 *   node --test "src/lib/account-scope.test.ts"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assignableRoles, canManage } from "./account-scope.ts";

test("オーナーは全員、店長はスタッフ・事務・閲覧のみだけ", () => {
  assert.equal(canManage("owner", "owner"), true);
  assert.equal(canManage("owner", "manager"), true);
  assert.equal(canManage("manager", "staff"), true);
  assert.equal(canManage("manager", "jimu"), true);
  assert.equal(canManage("manager", "viewer"), true);
  assert.equal(canManage("manager", "manager"), false);
  assert.equal(canManage("manager", "owner"), false);
  assert.equal(canManage("staff", "staff"), false);
  assert.equal(canManage("jimu", "staff"), false);
});

test("店長はオーナー・店長を付けられない", () => {
  assert.deepEqual(assignableRoles("manager"), ["staff", "jimu", "viewer"]);
  assert.equal(assignableRoles("owner").length, 5);
  assert.deepEqual(assignableRoles("staff"), []);
});
