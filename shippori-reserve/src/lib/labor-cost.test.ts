/*
 *   node --test "src/lib/labor-cost.test.ts"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { employeeDayCost, lateNightMinutes, LABOR_INS_RATE, payrollTotal, perDayCommute, monthlyFixedAllowances } from "./labor-cost.ts";

const t = (hhmm: string, day = "2026-11-07") => `${day}T${hhmm}:00+09:00`;
const ins = 1 + LABOR_INS_RATE;

test("深夜（22〜5時）の分：日付をまたぐ勤務・休憩を引く", () => {
  // 18:00〜翌1:00、22:30〜23:00 休憩 → 深夜は 22:00〜1:00 の180分 − 30分
  assert.equal(
    lateNightMinutes({
      date: "2026-11-07",
      clock_in_at: t("18:00"),
      clock_out_at: t("01:00", "2026-11-08"),
      break_records: [{ clock_in_at: t("22:30"), clock_out_at: t("23:00") }],
    }),
    150,
  );
  assert.equal(lateNightMinutes({ date: "2026-11-07", clock_in_at: t("17:00"), clock_out_at: t("21:30") }), 0);
});

test("時給：時給×時間＋深夜割増＋8時間超の割増、雇用保険の会社負担", () => {
  const m = { pay: { pay_calc_type: "hourly", pay_amount: 1000 }, allowances: [], insuredRemuneration: null };
  // 6時間・うち深夜2時間 → 6,000 + 1000×0.25×2 = 6,500
  assert.equal(Math.round(employeeDayCost(m, { workMin: 360, lateNightMin: 120 }, true, 26)), Math.round(6500 * ins));
  // 9時間（1時間超過）・深夜0 → 9,000 + 250 = 9,250
  assert.equal(Math.round(employeeDayCost(m, { workMin: 540, lateNightMin: 0 }, true, 26)), Math.round(9250 * ins));
  // 出勤していない日は0
  assert.equal(employeeDayCost(m, null, true, 26), 0);
});

test("月給：営業日で割る。休業日は0。社会保険の会社負担（標準報酬×15%）も営業日で割る", () => {
  const m = { pay: { pay_calc_type: "monthly", pay_amount: 260_000 }, allowances: [], insuredRemuneration: 260_000 };
  const day = employeeDayCost(m, { workMin: 480, lateNightMin: 0 }, true, 26);
  // 10,000 × 1.013 ＋ 260,000×0.15÷26（1,500）
  assert.equal(Math.round(day), Math.round(10_000 * ins + 1_500));
  assert.equal(employeeDayCost(m, null, false, 26), 0);
});

test("手当：毎月決まった額は営業日で割り、日ごとの通勤手当は出勤した日だけ", () => {
  const as = [
    { allowance_name: "通勤手当", amount: 300, frequency: "salary_this_month", calc_type: "attendance_day_tag" },
    { allowance_name: "役職手当", amount: 26_000, frequency: "salary_this_month", calc_type: "fixed" },
    { allowance_name: "賞与加算", amount: 99_999, frequency: "bonus", calc_type: "fixed" },
  ];
  assert.equal(perDayCommute(as), 300);
  assert.equal(monthlyFixedAllowances(as), 26_000);
  const m = { pay: { pay_calc_type: "hourly", pay_amount: 1000 }, allowances: as, insuredRemuneration: null };
  // 4時間：4,000 + 通勤300 + 役職手当1,000（26,000÷26）
  assert.equal(Math.round(employeeDayCost(m, { workMin: 240, lateNightMin: 0 }, true, 26)), Math.round(5_300 * ins));
  // 休みの日（営業日）は役職手当の割り振りだけ
  assert.equal(Math.round(employeeDayCost(m, null, true, 26)), Math.round(1_000 * ins));
});

test("給与明細の合計：役員を除いた 総支給額＋会社負担の法定福利費", () => {
  assert.equal(
    payrollTotal([
      { is_board_member: false, gross_payment_amount: "250000", total_deduction_employer_share: "38000" },
      { is_board_member: false, gross_payment_amount: "80000", total_deduction_employer_share: "1000" },
      { is_board_member: true, gross_payment_amount: "300000", total_deduction_employer_share: "45000" },
    ]),
    369_000,
  );
});
