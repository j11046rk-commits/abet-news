/*
 * 人時売上の計算を固定する。
 *
 *   node --test "src/lib/labor.test.ts"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtHours, perLaborHour, sumByDate, workMinutesOf } from "./labor.ts";

const t = (hhmm: string, day = "2026-10-23") => `${day}T${hhmm}:00+09:00`;

test("出退勤の時刻から休憩を引いて数える", () => {
  const min = workMinutesOf({
    date: "2026-10-23",
    work_record_segments: [{ clock_in_at: t("18:00"), clock_out_at: t("23:30") }],
    break_records: [{ clock_in_at: t("21:00"), clock_out_at: t("21:30") }],
  });
  assert.equal(min, 300);
});

test("日付をまたいだ退勤（25時）も数える", () => {
  const min = workMinutesOf({
    date: "2026-10-23",
    clock_in_at: t("19:00"),
    clock_out_at: t("01:00", "2026-10-24"),
  });
  assert.equal(min, 360);
});

test("出退勤が2回ある日は両方足す。区間の外の休憩は引かない", () => {
  const min = workMinutesOf({
    date: "2026-10-23",
    work_record_segments: [
      { clock_in_at: t("11:00"), clock_out_at: t("13:00") },
      { clock_in_at: t("18:00"), clock_out_at: t("22:00") },
    ],
    break_records: [{ clock_in_at: t("14:00"), clock_out_at: t("15:00") }],
  });
  assert.equal(min, 360);
});

test("退勤していない区間・欠勤は0", () => {
  assert.equal(workMinutesOf({ date: "2026-10-23", clock_in_at: t("18:00"), clock_out_at: null }), 0);
  assert.equal(
    workMinutesOf({ date: "2026-10-23", clock_in_at: t("18:00"), clock_out_at: t("22:00"), is_absence: true }),
    0,
  );
});

test("日付ごとに全員を合計し、期間外と重複は数えない", () => {
  const a = [
    { date: "2026-10-23", clock_in_at: t("18:00"), clock_out_at: t("23:00") },
    { date: "2026-10-23", clock_in_at: t("18:00"), clock_out_at: t("23:00") }, // 重複
    { date: "2026-09-30", clock_in_at: t("18:00", "2026-09-30"), clock_out_at: t("23:00", "2026-09-30") },
  ];
  const b = [{ date: "2026-10-23", clock_in_at: t("19:00"), clock_out_at: t("23:00") }];
  const m = sumByDate([a, b], "2026-10-01", "2026-10-31");
  assert.deepEqual(m.get("2026-10-23"), { workMin: 540, headcount: 2 });
  assert.equal(m.has("2026-09-30"), false);
});

test("人時売上＝売上÷時間", () => {
  assert.equal(perLaborHour(120000, 1200), 6000);
  assert.equal(perLaborHour(120000, 0), null);
  assert.equal(perLaborHour(null, 600), null);
  assert.equal(fmtHours(750), "12.5h");
});
