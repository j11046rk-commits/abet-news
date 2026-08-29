import Link from "next/link";
import LineFollowersKpi from "@/components/LineFollowersKpi";
import SalesBoard, { type SalesBoardDay } from "@/components/SalesBoard";
import { requireProfile } from "@/lib/auth";
import { can } from "@/lib/constants";
import { isHoliday } from "@/lib/holidays";
import {
  deriveBusinessDay,
  getAllProfiles,
  getMonthLineFollowers,
  getMonthlySalesTarget,
  getMonthSales,
  getMonthShifts,
  getMonthSummaries,
  getMonthWeather,
  getSettings,
  getShiftPublication,
} from "@/lib/queries";
import { fmtYen, hitOf, salesView } from "@/lib/sales";
import { WEATHER_ICON, WEATHER_JA } from "@/lib/weather";
import { surname } from "@/lib/staff";
import {
  fmtMonthJa,
  fmtYm,
  monthRange,
  shiftDate,
  shiftMonth,
  todayBizDate,
  WEEKDAY_JA,
  weekdayOf,
} from "@/lib/time";

export const dynamic = "force-dynamic";

const YM_RE = /^\d{4}-\d{2}$/;

/**
 * 売上タブ。日毎の目標と実績をグラフで見る（全員が見られる・店主指定）。
 * 実績はエアレジ→週次レポート経由の取り込み。目標は営業日の設定から入力。
 *
 * 物差しが2つある（店主指示 2026-08）。日毎の数字と達成判定は店内の売上だけ、
 * 月間の合計と目標の達成は物販込みの合計。物販は別枠のカードに出す。
 */
export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const me = await requireProfile();
  const sp = await searchParams;
  const today = todayBizDate();
  const ym = YM_RE.test(sp.m ?? "") ? sp.m! : fmtYm(today);

  const [sales, monthlyTarget, summaries, settings, shiftMap, shiftsPublishedAt, profiles, weather, lineMap] =
    await Promise.all([
      getMonthSales(ym),
      getMonthlySalesTarget(ym),
      getMonthSummaries(ym),
      getSettings(),
      getMonthShifts(ym),
      getShiftPublication(ym),
      getAllProfiles(),
      getMonthWeather(ym),
      getMonthLineFollowers(ym),
    ]);

  /*
   * LINE友だちの増減（店主要望 2026-08-28: 月の合計と日ごとの増加を売上タブでも）。
   * lineMap は日次の総数スナップショット（月初の前日も1日ぶん入っている）。
   * 前日との差がその日の増減、月間は「最後の総数 − 最初の総数」。
   */
  const lineDates = [...lineMap.keys()].sort();
  const lineLatest = lineDates.length > 0 ? (lineMap.get(lineDates.at(-1)!) ?? null) : null;
  const lineMonthGain =
    lineDates.length >= 2
      ? (lineMap.get(lineDates.at(-1)!) ?? 0) - (lineMap.get(lineDates[0]!) ?? 0)
      : null;
  const lineDeltaOf = (d: string): number | null => {
    const now = lineMap.get(d);
    const prev = lineMap.get(shiftDate(d, -1));
    return now != null && prev != null ? now - prev : null;
  };

  const { from, to } = monthRange(ym);
  const days: SalesBoardDay[] = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    const dow = weekdayOf(d);
    // 店内・物販・合計への読み替えは lib/sales.ts の1か所だけで行う
    const row = sales.get(d);
    const v = salesView(row);
    // 天気マーク（晴☀️・曇☁️・雨☂️）。売上との相関を目で追うため（店主要望 2026-08-28）
    const wx = weather.get(d);
    days.push({
      date: d,
      day: Number(d.slice(8)),
      dow,
      dowLabel: WEEKDAY_JA[dow],
      holiday: isHoliday(d),
      closed: summaries.get(d)?.is_closed ?? deriveBusinessDay(d, settings).is_closed,
      target: v.target,
      dineIn: v.dineIn,
      retail: v.retail,
      total: v.total,
      guests: row?.guest_count ?? null,
      checks: row?.check_count ?? null,
      isToday: d === today,
      wx: wx ? WEATHER_ICON[wx.weather] : null,
      wxForecast: wx?.is_forecast ?? false,
      lineGain: lineDeltaOf(d),
    });
  }

  // 達成貢献⭐：達成した日に出勤していた人に星（確定シフト×達成日・店主承認の案C）
  // 達成の定義はグリッドの金色セル・連続達成と同じ hitOf（＝店内の売上だけで見る）。
  const shiftEligible = profiles
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.is_active && p.role !== "owner" && p.role !== "viewer");
  const stars = new Map<string, number>(shiftEligible.map(({ p }) => [p.id, 0]));
  if (shiftsPublishedAt) {
    for (const d of days) {
      if (!hitOf(d)) continue;
      for (const id of shiftMap.get(d.date) ?? []) {
        if (stars.has(id)) stars.set(id, (stars.get(id) ?? 0) + 1);
      }
    }
  }
  const contrib = shiftEligible
    .map(({ p, i }) => ({ id: p.id, name: surname(p.display_name), colorIndex: i, stars: stars.get(p.id) ?? 0 }))
    .sort((a, b) => b.stars - a.stars);

  return (
    <>
      <header className="appbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-face-96.png" alt="しっぽり亭" width={96} height={96} className="appbar__logo" />
        <Link className="btn btn-sm" href={`/sales?m=${fmtYm(shiftMonth(`${ym}-01`, -1))}`} aria-label="前の月">
          ‹
        </Link>
        <div>
          <div className="appbar__title">{fmtMonthJa(`${ym}-01`)} 売上</div>
          <div className="appbar__sub">目標と実績</div>
        </div>
        <Link className="btn btn-sm" href={`/sales?m=${fmtYm(shiftMonth(`${ym}-01`, 1))}`} aria-label="次の月">
          ›
        </Link>
        <div className="appbar__spacer" />
        <Link className="btn btn-sm" href={`/sales/year?y=${ym.slice(0, 4)}`}>
          年間
        </Link>
      </header>

      <div className="wrap stack">
        {/* LINE友だち（店主要望 2026-08-28）。友だち集めの成果を売上と同じ画面で追う。
            目標（KPI・2026-08-29）までの残りと進捗バーも出す */}
        <LineFollowersKpi
          latest={lineLatest}
          monthGain={lineMonthGain}
          target={Number(settings.line_followers_target) || 0}
        />
        {/*
          今日の詳細（店主要望 2026-08-28）。グリッドの小さなマスでは
          目標・予約・天気が一度に読めないので、当日ぶんだけ上に開いて見せる。
          会計の実績はエアレジから翌朝届くため、届くまでは予約と目標が主役。
        */}
        {ym === today.slice(0, 7)
          ? (() => {
              // 行が無い日（まだ誰も触っていない日）は曜日から導出。
              // 予約の集計はビュー(DailySummary)にしか無いので、無ければ0件
              const ts = summaries.get(today);
              const closed = ts?.is_closed ?? deriveBusinessDay(today, settings).is_closed;
              const trow = sales.get(today);
              const tv = salesView(trow);
              const twx = weather.get(today);
              const remain =
                tv.target != null && tv.dineIn != null ? tv.target - tv.dineIn : null;
              return (
                <section className="todaycard" aria-label="今日の詳細">
                  <p className="todaycard__head">
                    今日 {Number(today.slice(8))}日（{WEEKDAY_JA[weekdayOf(today)]}）
                    {twx
                      ? `　${WEATHER_ICON[twx.weather]}${WEATHER_JA[twx.weather]}${twx.is_forecast ? "(予報)" : ""}`
                      : ""}
                    {closed ? "　休業日" : ""}
                  </p>
                  {closed ? null : (
                    <div className="todaycard__grid">
                      <div>
                        <span className="todaycard__label">目標</span>
                        <span className="todaycard__num">
                          {tv.target ? fmtYen(tv.target) : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="todaycard__label">予約</span>
                        <span className="todaycard__num">
                          {ts?.reservation_count ?? 0}件・{ts?.guest_count ?? 0}名
                        </span>
                      </div>
                      {tv.dineIn != null ? (
                        <>
                          <div>
                            <span className="todaycard__label">店内実績</span>
                            <span className="todaycard__num">{fmtYen(tv.dineIn)}</span>
                          </div>
                          {remain != null ? (
                            <div>
                              <span className="todaycard__label">
                                {remain > 0 ? "目標まで" : "目標超え"}
                              </span>
                              <span className="todaycard__num">{fmtYen(Math.abs(remain))}</span>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className="todaycard__note">会計の実績は翌朝ここに入ります</span>
                      )}
                    </div>
                  )}
                </section>
              );
            })()
          : null}
        <SalesBoard
          key={ym}
          days={days}
          today={today}
          monthlyTarget={monthlyTarget}
          contrib={contrib}
          shiftsPublished={!!shiftsPublishedAt}
        />

        {can(me.role, "sales.write") ? (
          <p className="micro" style={{ textAlign: "center" }}>
            目標・実績の手入力は カレンダー → 日付 → <strong>営業日の設定</strong> から。
            実績はエアレジ（週次レポート）から自動で取り込めます。
            物販（お持ち帰り）があった日も、同じ画面から入れられます。
          </p>
        ) : null}

        <div style={{ height: "2rem" }} />
      </div>
    </>
  );
}
