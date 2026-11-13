/*
 *   node --test "src/lib/backup-watch.test.ts"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { backupNotice, daysSinceBackup } from "./backup-watch.ts";

const jst = (ymd: string, hhmm = "12:00") => new Date(`${ymd}T${hhmm}:00+09:00`);
const last = jst("2026-11-13", "04:30").toISOString();

test("何日たったかは日本時間の日付で数える（取った時刻には左右されない）", () => {
  assert.equal(daysSinceBackup(last, jst("2026-11-13")), 0);
  assert.equal(daysSinceBackup(last, jst("2026-11-14", "00:10")), 1);
  assert.equal(daysSinceBackup(last, jst("2026-11-21")), 8);
  // 深夜23:50に取った控えも、翌日の昼には「1日前」
  assert.equal(daysSinceBackup(jst("2026-11-13", "23:50").toISOString(), jst("2026-11-14")), 1);
});

test("記録が無い・読めないときは null", () => {
  for (const bad of [null, undefined, "", 123, "きのう", {}]) {
    assert.equal(daysSinceBackup(bad, jst("2026-11-13")), null);
  }
});

test("7日までは知らせない。8日目に知らせる", () => {
  assert.equal(backupNotice(last, jst("2026-11-13")), null);
  assert.equal(backupNotice(last, jst("2026-11-20")), null);
  const msg = backupNotice(last, jst("2026-11-21"));
  assert.match(msg ?? "", /バックアップが8日止まっています（最後は11\/13）/);
});

test("直るまで毎日は鳴らさない。8日目のあとは3日おき", () => {
  assert.equal(backupNotice(last, jst("2026-11-22")), null);
  assert.equal(backupNotice(last, jst("2026-11-23")), null);
  assert.match(backupNotice(last, jst("2026-11-24")) ?? "", /11日止まっています/);
  assert.equal(backupNotice(last, jst("2026-11-25")), null);
  assert.match(backupNotice(last, jst("2026-11-27")) ?? "", /14日止まっています/);
});

test("一度も取られていないときは、月曜にだけ知らせる", () => {
  // 2026-11-16 は月曜
  assert.match(backupNotice(null, jst("2026-11-16")) ?? "", /まだ一度も取られていません/);
  assert.equal(backupNotice(null, jst("2026-11-15")), null);
  assert.equal(backupNotice(null, jst("2026-11-17")), null);
  assert.match(backupNotice(null, jst("2026-11-23")) ?? "", /まだ一度も取られていません/);
});
