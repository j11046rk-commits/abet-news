/*
 * 1日の人件費（店全体の合計）の計算（店主指示 2026-11-09「人件費も毎日リアルタイムで。時給と労働時間と交通費から
 * その日の人件費の合計を出して、この日の人件費率を明示したい」「社会保険の会社負担も入れる」）。
 *
 * ★一人ずつの額は、この計算の中でだけ使い、どこにも保存しない・返さない。返すのは日ごとの合計だけ。
 *   （店主指示 2026-11-09「個人の人件費はちゃんと隠して」）
 *
 * 決めごと（給与が確定するまでの速報。確定した月は給与明細の合計＝実際に置き換わる）
 *   時給 … 時給 × 労働時間。22〜5時は深夜割増 +25%、1日8時間を超えた分は時間外割増 +25%
 *   日給 … 出勤した日に日給。8時間を超えた分は日給÷8 × 1.25
 *   月給 … 月給 ÷ その月の営業日数 を営業日ごとに。8時間を超えた分・深夜は 月給÷173時間 を時給として割増
 *   手当 … 毎月決まった額（fixed・variable）は営業日ごとに割る。通勤手当のうち日ごとのもの（勤怠に応じた手当）は出勤した日に単価
 *   社会保険の会社負担 … 健康保険か厚生年金に入っている人は 標準報酬月額 × 15%（健保・介護・厚年・子育て拠出の目安）を営業日ごとに
 *   雇用保険・労災の会社負担 … 賃金 × 1.3%（目安）
 *   役員（給与明細で役員の人）は入れない
 *
 * このファイルは値の import を持たない（node --test で直に回せるようにするため）。
 */

export const SOCIAL_INS_RATE = 0.15;
export const LABOR_INS_RATE = 0.013;
export const PREMIUM = 0.25;
/** 月給を時給に直すときの月の所定時間（目安） */
export const MONTHLY_HOURS = 173;
const DAY_MIN = 8 * 60;

export type PayRule = { pay_calc_type: "monthly" | "daily" | "hourly" | string; pay_amount: number | null };
export type AllowanceRule = { allowance_name?: string | null; amount?: number | null; frequency?: string | null; calc_type?: string | null };

export type EmployeeMonth = {
  pay: PayRule | null;
  allowances: AllowanceRule[];
  /** 健康保険か厚生年金に入っているときの標準報酬月額（入っていなければ null） */
  insuredRemuneration: number | null;
};

export type DayWork = { workMin: number; lateNightMin: number };

const isCommute = (a: AllowanceRule) => (a.allowance_name ?? "").includes("通勤");

/** 毎月決まって払う手当（営業日で割るもの） */
export function monthlyFixedAllowances(as: AllowanceRule[]): number {
  return as
    .filter((a) => a.frequency !== "bonus" && (a.calc_type === "fixed" || a.calc_type === "variable") && (a.amount ?? 0) > 0)
    .reduce((s, a) => s + (a.amount ?? 0), 0);
}

/** 出勤した日ごとに払う通勤手当（勤怠に応じた手当の単価） */
export function perDayCommute(as: AllowanceRule[]): number {
  return as
    .filter((a) => a.frequency !== "bonus" && isCommute(a) && (a.calc_type === "attendance_day_tag" || a.calc_type === "custom") && (a.amount ?? 0) > 0)
    .reduce((s, a) => s + (a.amount ?? 0), 0);
}

/**
 * 1人・1日の人件費（円・小数のまま）。呼ぶ側で全員を足してから丸める。
 * work が null＝その日は出勤していない。businessDay＝その日が営業日か（月給・決まった手当・社会保険を割り振る日）
 */
export function employeeDayCost(m: EmployeeMonth, work: DayWork | null, businessDay: boolean, businessDaysInMonth: number): number {
  const pay = m.pay?.pay_amount ?? 0;
  const type = m.pay?.pay_calc_type;
  const share = businessDay && businessDaysInMonth > 0 ? 1 / businessDaysInMonth : 0;
  let wage = 0;

  if (type === "hourly" && work) {
    const over = Math.max(0, work.workMin - DAY_MIN);
    wage += (pay * work.workMin) / 60 + (pay * PREMIUM * (work.lateNightMin + over)) / 60;
  } else if (type === "daily" && work && work.workMin > 0) {
    const over = Math.max(0, work.workMin - DAY_MIN);
    wage += pay + ((pay / 8) * (1 + PREMIUM) * over) / 60;
  } else if (type === "monthly") {
    wage += pay * share;
    if (work) {
      const hourly = pay / MONTHLY_HOURS;
      const over = Math.max(0, work.workMin - DAY_MIN);
      wage += (hourly * (1 + PREMIUM) * over) / 60 + (hourly * PREMIUM * work.lateNightMin) / 60;
    }
  }

  wage += monthlyFixedAllowances(m.allowances) * share;
  if (work && work.workMin > 0) wage += perDayCommute(m.allowances);

  const social = m.insuredRemuneration ? m.insuredRemuneration * SOCIAL_INS_RATE * share : 0;
  return wage * (1 + LABOR_INS_RATE) + social;
}

type Span = { clock_in_at?: string | null; clock_out_at?: string | null };
const range = (s: Span): [number, number] | null => {
  if (!s.clock_in_at || !s.clock_out_at) return null;
  const a = Date.parse(s.clock_in_at);
  const b = Date.parse(s.clock_out_at);
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? [a, b] : null;
};

/** 22:00〜翌5:00（日本時間）の深夜の区間を、その日の前後1日ぶん並べる */
function nightWindows(date: string): [number, number][] {
  const base = Date.parse(`${date}T00:00:00+09:00`);
  const h = 3600_000;
  return [-1, 0, 1].map((d) => [base + d * 24 * h + 22 * h, base + (d + 1) * 24 * h + 5 * h] as [number, number]);
}

const overlap = (a: [number, number], b: [number, number]) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));

/** その日の深夜（22〜5時）の労働時間（分）。休憩と重なる分は引く */
export function lateNightMinutes(rec: {
  date: string;
  clock_in_at?: string | null;
  clock_out_at?: string | null;
  work_record_segments?: Span[] | null;
  break_records?: Span[] | null;
  is_absence?: boolean | null;
}): number {
  if (rec.is_absence) return 0;
  const segs = (rec.work_record_segments && rec.work_record_segments.length > 0 ? rec.work_record_segments : [rec])
    .map(range)
    .filter((r): r is [number, number] => r != null);
  const breaks = (rec.break_records ?? []).map(range).filter((r): r is [number, number] => r != null);
  let ms = 0;
  for (const w of nightWindows(rec.date)) {
    for (const s of segs) {
      const part = overlap(w, s);
      if (part <= 0) continue;
      const lo: [number, number] = [Math.max(w[0], s[0]), Math.min(w[1], s[1])];
      ms += part - breaks.reduce((x, b) => x + overlap(lo, b), 0);
    }
  }
  return Math.max(0, Math.round(ms / 60000));
}

/** 給与明細（実際）の店全体の合計：役員を除いた 総支給額 ＋ 法定福利費の会社負担 */
export function payrollTotal(
  statements: { is_board_member?: boolean | null; gross_payment_amount?: string | number | null; total_deduction_employer_share?: string | number | null }[],
): number {
  const n = (v: string | number | null | undefined) => {
    const x = typeof v === "number" ? v : Number(v ?? 0);
    return Number.isFinite(x) ? x : 0;
  };
  return Math.round(
    statements.filter((s) => !s.is_board_member).reduce((a, s) => a + n(s.gross_payment_amount) + n(s.total_deduction_employer_share), 0),
  );
}
