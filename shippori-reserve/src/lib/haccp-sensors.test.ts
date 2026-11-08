/*
 *   node --test "src/lib/haccp-sensors.test.ts"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { alertText, bizDayStartIso, dailyRecord, decideAlerts, excursions, type Reading } from "./haccp-sensors.ts";

const freezer = { maxC: -15, minC: null };
const at = (hhmm: string) => new Date(`2026-11-08T${hhmm}:00+09:00`).toISOString();
const r = (hhmm: string, t: number, h = 40, b = 100): Reading => ({ temp_c: t, humidity: h, battery: b, read_at: at(hhmm) });
const now = new Date(at("12:00"));

test("基準外は2回続いたときだけ知らせる（扉の開け閉め・霜取りの一瞬では鳴らさない）", () => {
  assert.deepEqual(decideAlerts([r("12:00", -10), r("11:30", -18)], freezer, {}, now).send, []);
  assert.deepEqual(decideAlerts([r("12:00", -10), r("11:30", -12)], freezer, {}, now).send, ["out_of_range"]);
});

test("同じ知らせは3時間空ける。基準内に戻ったら「戻りました」", () => {
  const sent = { out_of_range: at("10:00") };
  assert.deepEqual(decideAlerts([r("12:00", -10), r("11:30", -12)], freezer, sent, now).send, []);
  assert.deepEqual(decideAlerts([r("12:00", -10), r("11:30", -12)], freezer, { out_of_range: at("08:30") }, now).send, ["out_of_range"]);
  assert.equal(decideAlerts([r("12:00", -19), r("11:30", -12)], freezer, sent, now).recovered, true);
  assert.equal(decideAlerts([r("12:00", -19), r("11:30", -18)], freezer, {}, now).recovered, false);
});

test("値が3時間まったく同じ＝止まっている可能性。電池20%以下も知らせる", () => {
  const same = ["12:00", "11:30", "11:00", "10:30", "10:00", "09:30"].map((h) => r(h, -18.2, 35));
  assert.ok(decideAlerts(same, freezer, {}, now).send.includes("stale"));
  const moving = same.map((x, i) => ({ ...x, temp_c: -18 - i * 0.1 }));
  assert.ok(!decideAlerts(moving, freezer, {}, now).send.includes("stale"));
  assert.ok(decideAlerts([r("12:00", -18, 40, 20)], freezer, {}, now).send.includes("battery"));
  assert.ok(!decideAlerts([r("12:00", -18, 40, 60)], freezer, {}, now).send.includes("battery"));
});

test("参考に見るだけの温度計（設備に結びつけていない）は基準外を判定しない", () => {
  assert.deepEqual(decideAlerts([r("12:00", 30), r("11:30", 30)], null, {}, now).send, []);
});

test("毎晩の記録：最後の値・最低最高。基準外が続いた時間があれば、最後が基準内でも「問題あり」にして時間を書く", () => {
  const day = [r("05:00", -19), r("10:00", -12), r("10:30", -11.5), r("11:00", -18), r("23:30", -19.5)];
  const rec = dailyRecord(day, freezer)!;
  assert.equal(rec.result, "ng");
  assert.equal(rec.temp_c, -19.5);
  assert.equal(rec.measured_at, at("23:30"));
  assert.ok(rec.note.includes("10:00〜10:30（最大-11.5℃）"));
  assert.ok(rec.note.includes("最低-19.5℃／最高-11.5℃"));

  const okDay = [r("05:00", -19), r("10:00", -12), r("10:30", -18), r("23:30", -19)];
  assert.equal(dailyRecord(okDay, freezer)!.result, "ok"); // 1回だけの上がりは問題にしない
  assert.equal(dailyRecord([], freezer), null); // 値が無ければ書かない
  assert.equal(excursions(okDay, freezer).length, 0);
});

test("冷蔵庫（10℃以下）でも同じ。営業日は朝4時から", () => {
  const fridge = { maxC: 10, minC: null };
  assert.equal(dailyRecord([r("20:00", 12), r("20:30", 13), r("23:00", 6)], fridge)!.result, "ng");
  assert.equal(bizDayStartIso("2026-11-08"), "2026-11-07T19:00:00.000Z");
  assert.ok(alertText("out_of_range", "冷凍庫①", r("12:00", -10), freezer).includes("-15℃以下"));
});
