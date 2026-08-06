import "server-only";
import { ceilDiv } from "@/lib/money";
import {
  getMonthlySummary,
  getSessionStats,
  getSettings,
} from "@/lib/queries";
import { daysLeftInMonth, fmtYm, nowJst } from "@/lib/time";

export type Vault = {
  /** 今月の積立額 = 当月の収入合計 − 当月の支出合計 */
  saved: number;
  target: number;
  /** 不足額。達成していれば 0 */
  shortfall: number;
  /** 直近90日の平均レーキ。セッションが無ければ null */
  avgRake: number | null;
  /** 不足を埋めるのに必要な開催回数。avgRake が無ければ null */
  sessionsNeeded: number | null;
  /** 今月の残り日数（今日を含む） */
  daysLeft: number;
  /** 不足した場合の1人あたりの負担 */
  perOwner: number;
  /** 前月までの累計収支 */
  carryover: number;
  ownerCount: number;
  facilityName: string;
  /** 残高がゼロを割る予測月（YYYY-MM）。割らない見込みなら null */
  breakEvenMonth: string | null;
};

export async function getVault(): Promise<Vault> {
  const [settings, monthly, stats] = await Promise.all([
    getSettings(),
    getMonthlySummary(),
    getSessionStats(),
  ]);

  const ym = fmtYm(nowJst());
  const current = monthly.find((m) => m.ym === ym);
  const saved = current?.net_yen ?? 0;
  const target = settings.monthly_target_yen;
  const shortfall = Math.max(0, target - saved);

  const past = monthly.filter((m) => m.ym < ym);
  const carryover = past.length ? past[past.length - 1].balance_yen : 0;

  const avgRake = stats.avg_rake_90d_yen > 0 ? stats.avg_rake_90d_yen : null;

  return {
    saved,
    target,
    shortfall,
    avgRake,
    sessionsNeeded: avgRake && shortfall > 0 ? ceilDiv(shortfall, avgRake) : avgRake ? 0 : null,
    daysLeft: daysLeftInMonth(),
    perOwner: ceilDiv(shortfall, settings.owner_count),
    carryover,
    ownerCount: settings.owner_count,
    facilityName: settings.facility_name,
    breakEvenMonth: forecastZeroMonth(monthly),
  };
}

/**
 * 残高がゼロを割る予測月。
 * 直近3ヶ月の平均月次収支を将来へ外挿し、初めて負になる月を返す。
 * 収支が黒字なら割らないので null。
 */
export function forecastZeroMonth(
  monthly: { ym: string; net_yen: number; balance_yen: number }[],
  horizon = 24,
): string | null {
  if (monthly.length === 0) return null;

  const last = monthly[monthly.length - 1];
  const recent = monthly.slice(-3);
  const avgNet = recent.reduce((s, m) => s + m.net_yen, 0) / recent.length;

  if (avgNet >= 0) return null;
  if (last.balance_yen < 0) return last.ym;

  let balance = last.balance_yen;
  const [y, m] = last.ym.split("-").map(Number);

  for (let i = 1; i <= horizon; i += 1) {
    balance += avgNet;
    if (balance < 0) {
      const d = new Date(Date.UTC(y, m - 1 + i, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    }
  }
  return null;
}
