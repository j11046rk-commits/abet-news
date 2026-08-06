import "server-only";
import { ceilDiv } from "@/lib/money";
import {
  getMeteredPosted,
  getMonthlySummary,
  getSessionStats,
  getSettings,
} from "@/lib/queries";
import { daysLeftInMonth, fmtYm, nowJst } from "@/lib/time";
import { METERED_CATEGORIES } from "@/lib/types";

export type Vault = {
  /**
   * 今月の運営収入（レーキ・ゲストフィー・ドリンク）。出資は含めない。
   *
   * 月次目標 ¥100,000 は「家賃＋共益費＋水道光熱でおよそ10万円かかるから、
   * それをレーキで賄う」という意味の数字。だから比べる相手は稼いだ金であって、
   * 収支（収入 − 支出）ではない。収支にすると
   *   - 出資が達成額に混ざって一晩で目標達成に見える
   *   - 家賃を計上した分だけ達成額が下がり、10万円のために20万円必要になる
   * という二重の誤りが出る。
   */
  saved: number;
  target: number;
  /** 不足額。達成していれば 0 */
  shortfall: number;
  /** 目標を超えたぶん。施設に供託される。 */
  surplus: number;
  /** 直近90日の平均レーキ。セッションが無ければ null */
  avgRake: number | null;
  /** 不足を埋めるのに必要な開催回数。avgRake が無ければ null */
  sessionsNeeded: number | null;
  /** 今月の残り日数（今日を含む） */
  daysLeft: number;
  /** 不足した場合の1人あたりの負担 */
  perOwner: number;
  /**
   * 現時点の残高。今月ぶんまで含めた累計収支。
   *
   * 前月末の繰越ではない — 今月レーキが入ったのに数字が動かないと、
   * 「いま金庫にいくらあるのか」が読めない。
   */
  balance: number;
  ownerCount: number;
  facilityName: string;
  /** 残高がゼロを割る予測月（YYYY-MM）。割らない見込みなら null */
  breakEvenMonth: string | null;
  /** 今月まだ記帳されていないメーター費目（水道代・電気代）。開始月より前なら空。 */
  missingMetered: { value: string; ja: string }[];
};

export async function getVault(): Promise<Vault> {
  const ym = fmtYm(nowJst());
  const [settings, monthly, stats, metered] = await Promise.all([
    getSettings(),
    getMonthlySummary(),
    getSessionStats(),
    getMeteredPosted(ym),
  ]);

  const current = monthly.find((m) => m.ym === ym);
  const saved = current?.operating_income_yen ?? 0;
  const target = settings.monthly_target_yen;
  const shortfall = Math.max(0, target - saved);

  /*
   * balance_yen は古い月から積み上げた累計なので、今月以前の最後の行がいまの残高。
   * 「今月の行」を直に引かないのは、今月まだ1件も記帳が無いと行そのものが
   * 存在せず、残高が 0 に見えてしまうため。
   * 先の月の行（日付を先に入れた記帳）は「現時点」ではないので入れない。
   */
  const upToNow = monthly.filter((m) => m.ym <= ym);
  const balance = upToNow.length ? upToNow[upToNow.length - 1].balance_yen : 0;

  const avgRake = stats.avg_rake_90d_yen > 0 ? stats.avg_rake_90d_yen : null;

  // 請求は使った月の翌月に届く。開始月ぶんの請求が来る前から急かしても意味がない。
  const missingMetered =
    ym < settings.utilities_alert_from
      ? []
      : METERED_CATEGORIES.filter((c) => !metered.has(c.value));

  return {
    saved,
    target,
    shortfall,
    surplus: Math.max(0, saved - target),
    missingMetered,
    avgRake,
    sessionsNeeded: avgRake && shortfall > 0 ? ceilDiv(shortfall, avgRake) : avgRake ? 0 : null,
    daysLeft: daysLeftInMonth(),
    perOwner: ceilDiv(shortfall, settings.owner_count),
    balance,
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
