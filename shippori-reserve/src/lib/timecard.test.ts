/*
 *   node --test "src/lib/timecard.test.ts"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectIssues, issueMessage } from "./timecard.ts";

const t = (hhmm: string, day = "2026-11-07") => `${day}T${hhmm}:00+09:00`;

test("退勤なし・休憩の戻りなし・シフトなのに打刻なしを見つける", () => {
  const staff = [
    { id: 1, name: "白石 湧駕", records: [{ date: "2026-11-07", clock_in_at: t("18:02"), clock_out_at: null }] },
    {
      id: 2,
      name: "高木 雅也",
      records: [
        {
          date: "2026-11-07",
          clock_in_at: t("17:00"),
          clock_out_at: t("23:00"),
          break_records: [{ clock_in_at: t("20:00"), clock_out_at: null }],
        },
      ],
    },
    { id: 3, name: "安藤　正", records: [] },
    { id: 4, name: "金本 絵美", records: [{ date: "2026-11-07", clock_in_at: t("18:00"), clock_out_at: t("22:00") }] },
  ];
  const scheduled = new Map([["2026-11-07", ["安藤 正", "金本 絵美", "白石 湧駕", "アプリだけの人"]]]);
  const r = detectIssues(staff, scheduled, "2026-11-01", "2026-11-07");
  assert.deepEqual(
    r.map((i) => [i.name, i.kind, i.detail]),
    [
      ["安藤　正", "no_clock_in", null], // 全角空白の揺れも同じ人
      ["高木 雅也", "no_break_end", "休憩 20:00〜"],
      ["白石 湧駕", "no_clock_out", "出勤 18:02"],
    ],
  );
});

test("期間の外・欠勤の日は見ない", () => {
  const staff = [
    { id: 1, name: "A", records: [{ date: "2026-11-08", clock_in_at: t("18:00", "2026-11-08"), clock_out_at: null }] },
    { id: 2, name: "B", records: [{ date: "2026-11-07", clock_in_at: t("18:00"), clock_out_at: null, is_absence: true }] },
  ];
  assert.deepEqual(detectIssues(staff, new Map(), "2026-11-01", "2026-11-07"), []);
});

test("店長LINEの文面：ユウトさんが時刻を書く→アリサさんが直す。金額は書かない", () => {
  const m = issueMessage([{ date: "2026-11-07", employeeId: 1, name: "白石 湧駕", kind: "no_clock_out", detail: "出勤 18:02" }]);
  assert.ok(m.includes("・11/7 白石 湧駕さん：退勤なし（出勤 18:02）"));
  assert.ok(m.includes("ユウトさん：実際の時刻"));
  assert.ok(m.includes("アリサさん：freee人事労務で直して"));
  assert.ok(!/円/.test(m));
});
