/*
 * シフトの時間の読み方を固定する。
 *   node --test "src/lib/shift-time.test.ts"
 *
 * 店主から聞き取った基本の時間（2026-08-17）:
 *   金本 19:30〜LAST ／ 安藤 18:00〜20:00 ／ 白石 18:30〜LAST
 *   高木 19:00〜LAST ／ 安井 18:30〜21:00 ／ 店長は時間を持たない
 * LAST は金土25:00・それ以外0:00。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  closeMinOf,
  isDefaultTime,
  resolveShiftTime,
  shiftStartLabel,
  shiftTimeLabel,
} from "./shift-time.ts";

const 金本 = { default_start_min: 1170, default_end_min: null };
const 安井 = { default_start_min: 1110, default_end_min: 1260 };
const 店長 = { default_start_min: null, default_end_min: null };

test("行に時刻が無ければ、本人の基本を使う", () => {
  assert.deepEqual(resolveShiftTime({ start_min: null, end_min: null }, 金本), {
    start: 1170,
    end: null,
  });
  assert.deepEqual(resolveShiftTime({ start_min: null, end_min: null }, 安井), {
    start: 1110,
    end: 1260,
  });
});

test("行に時刻があれば、その日はそちらが勝つ", () => {
  assert.deepEqual(resolveShiftTime({ start_min: 1200, end_min: 1380 }, 金本), {
    start: 1200,
    end: 1380,
  });
});

test("行の end が null でも、start が入っていれば LAST の意味", () => {
  // 安井さんは基本21:00までだが、その日だけ最後まで、というとき
  assert.deepEqual(resolveShiftTime({ start_min: 1110, end_min: null }, 安井), {
    start: 1110,
    end: null,
  });
});

test("時間を持たない人（店長）は null", () => {
  assert.equal(resolveShiftTime({ start_min: null, end_min: null }, 店長), null);
  assert.equal(resolveShiftTime(null, 店長), null);
  assert.equal(resolveShiftTime(null, null), null);
});

test("LAST は金土25:00・それ以外0:00", () => {
  assert.equal(closeMinOf("2026-08-21"), 1500, "金曜");
  assert.equal(closeMinOf("2026-08-22"), 1500, "土曜");
  assert.equal(closeMinOf("2026-08-23"), 1440, "日曜");
  assert.equal(closeMinOf("2026-08-20"), 1440, "木曜");
});

test("その日の営業時間が上書きされていれば、そちらに従う", () => {
  // イベント営業で24:00までにした金曜。シフトのLASTも24:00になる
  assert.equal(closeMinOf("2026-08-21", { close_min: 1440 }), 1440);
});

test("表示：LAST はその日の閉店時刻を当てる", () => {
  const t = resolveShiftTime({ start_min: null, end_min: null }, 金本);
  assert.equal(shiftTimeLabel(t, closeMinOf("2026-08-21")), "19:30〜25:00");
  assert.equal(shiftTimeLabel(t, closeMinOf("2026-08-23")), "19:30〜24:00");
});

test("表示：終わりが決まっている人はそのまま", () => {
  const t = resolveShiftTime({ start_min: null, end_min: null }, 安井);
  assert.equal(shiftTimeLabel(t, closeMinOf("2026-08-21")), "18:30〜21:00");
});

test("表示：閉店が分からない日は「LAST」の字のまま（嘘の時刻を出さない）", () => {
  assert.equal(shiftTimeLabel({ start: 1170, end: null }, null), "19:30〜LAST");
});

test("表示：時間を持たない人は空文字（チップに余計なものを出さない）", () => {
  assert.equal(shiftTimeLabel(null, 1500), "");
  assert.equal(shiftStartLabel(null), "");
});

test("短い表示は開始だけ", () => {
  assert.equal(shiftStartLabel({ start: 1170, end: null }), "19:30〜");
});

test("基本と同じ日かどうかを見分ける（違う日だけ直させるため）", () => {
  assert.equal(isDefaultTime({ start_min: null, end_min: null }, 金本), true);
  assert.equal(isDefaultTime({ start_min: 1170, end_min: null }, 金本), true, "同じ値なら基本扱い");
  assert.equal(isDefaultTime({ start_min: 1200, end_min: null }, 金本), false);
  assert.equal(isDefaultTime({ start_min: 1110, end_min: null }, 安井), false, "終わりが違う");
});
