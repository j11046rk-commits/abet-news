/*
 * 席ボードを「表示のためだけ」に読む部分を固定する。
 *
 *   node --test "src/lib/seats.test.ts"
 *
 * ★ここが空き判定に混ざっていないことが肝。混ぜると、着席済みの予約を
 *   直せなくなる（埋めているのが本人なのに弾かれる）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { boardUsage, unitOfSeatKey } from "./seats.ts";

test("unitOfSeatKey: 1席ずつのキーを卓の名前に直す", () => {
  assert.equal(unitOfSeatKey("T2-3"), "T2"); // テーブルの3席目
  assert.equal(unitOfSeatKey("Z1"), "和室");
  assert.equal(unitOfSeatKey("C7"), "カウンター");
  assert.equal(unitOfSeatKey("C"), "カウンター"); // 旧方式（合計）
  assert.equal(unitOfSeatKey("T1"), "T1"); // 旧キーはそれ自体が卓名
  assert.equal(unitOfSeatKey("和室"), "和室");
});

test("boardUsage: 点いている席だけを拾う（0は座っていない）", () => {
  const r = boardUsage([
    { key: "T2", occupied: 1 },
    { key: "T1", occupied: 0 },
    { key: "C1", occupied: 1 },
    { key: "C2", occupied: 1 },
    { key: "C3", occupied: 1 },
  ]);
  assert.deepEqual(r.seated, ["T2"]);
  assert.equal(r.seated_counter, 3);
});

test("boardUsage: 何も点いていなければ印は出ない", () => {
  const r = boardUsage([
    { key: "T1", occupied: 0 },
    { key: "C1", occupied: 0 },
  ]);
  assert.deepEqual(r.seated, []);
  assert.equal(r.seated_counter, 0);
});

test("boardUsage: 旧'C'（合計）と C1〜C10（1席ずつ）は大きい方を採る", () => {
  // 旧方式だけ
  assert.equal(boardUsage([{ key: "C", occupied: 5 }]).seated_counter, 5);
  // 両方あるとき。数え直しの途中でも小さい方に落とさない
  assert.equal(
    boardUsage([
      { key: "C", occupied: 2 },
      { key: "C1", occupied: 1 },
      { key: "C2", occupied: 1 },
      { key: "C3", occupied: 1 },
    ]).seated_counter,
    3,
  );
});

test("boardUsage: 同じ卓が1席ずつ点いていても、卓は1つとして数える", () => {
  const r = boardUsage([
    { key: "T3-1", occupied: 1 },
    { key: "T3-2", occupied: 1 },
    { key: "Z1", occupied: 1 },
    { key: "Z2", occupied: 1 },
  ]);
  assert.deepEqual(r.seated, ["T3", "和室"]);
});

test("boardUsage: 空の入力でも落ちない（席ボードを一度も触っていない日）", () => {
  const r = boardUsage([]);
  assert.deepEqual(r.seated, []);
  assert.equal(r.seated_counter, 0);
});
