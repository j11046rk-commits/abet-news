import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { getProfileNames } from "@/lib/queries";
import { fmtMonthJa, fmtYm, monthRange, shiftDate, shiftMonth, todayBizDate, weekdayOf, WEEKDAY_JA } from "@/lib/time";
import { DAY_STATE_LABEL, INCIDENT_CATEGORY_LABEL, planForDate, requiredChecks, weekStart } from "@/lib/haccp";
import { getBatches, getChecks, getClosedDays, getDaysHaccp, getIncidents, getPlans, getReviews } from "@/lib/haccp-data";
import HaccpTabs from "../HaccpTabs";
import ReviewForm from "./ReviewForm";

export const dynamic = "force-dynamic";

const YM_RE = /^\d{4}-\d{2}$/;

/** オーナー・店長向け：月の記録の状態・週の確認・月の振り返り・出力 */
export default async function HaccpMonthPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requirePermission("haccp.manage");
  const sp = await searchParams;
  const today = todayBizDate();
  const ym = YM_RE.test(sp.m ?? "") ? sp.m! : fmtYm(today);
  const { from, to } = monthRange(ym);
  // 週の確認は月曜始まりなので、月の最初の週の月曜から読む
  const wFrom = weekStart(from);
  const [plans, closed, checks, batches, incidents, reviews, names, openAll] = await Promise.all([
    getPlans(),
    getClosedDays(wFrom, to),
    getChecks(wFrom, to),
    getBatches(wFrom, to),
    getIncidents({ from: wFrom, to }),
    getReviews(wFrom, to),
    getProfileNames(),
    getIncidents({ openOnly: true }),
  ]);
  const days = await getDaysHaccp(wFrom, to, today, { plans, closed, checks, batches, incidents });
  const monthDays = [...days.entries()].filter(([d]) => d >= from);

  // 繰り返している問題（この月に「問題あり」が2回以上あった項目）
  const ngCount = new Map<string, number>();
  for (const c of checks) {
    if (c.biz_date < from || c.first_result !== "ng") continue;
    const plan = planForDate(plans, c.biz_date);
    const label = plan ? requiredChecks(plan.content).find((r) => r.key === c.check_key)?.label ?? c.check_key : c.check_key;
    ngCount.set(label, (ngCount.get(label) ?? 0) + 1);
  }
  for (const i of incidents) {
    if (i.biz_date < from || i.source !== "manual") continue;
    const k = `${INCIDENT_CATEGORY_LABEL[i.category] ?? i.category}（${i.target}）`;
    ngCount.set(k, (ngCount.get(k) ?? 0) + 1);
  }
  const repeats = [...ngCount.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
  const missing = monthDays.filter(([, s]) => s.alert);
  const counts = { complete: 0, partial: 0, none: 0, closed: 0 } as Record<string, number>;
  for (const [, s] of monthDays) if (s.state in counts) counts[s.state]++;

  const weeks: string[] = [];
  for (let w = wFrom; w <= to; w = shiftDate(w, 7)) weeks.push(w);
  const reviewOf = (kind: "week" | "month", start: string) => reviews.find((r) => r.kind === kind && r.period_start === start) ?? null;
  const monthReview = reviewOf("month", from);
  const prevMonthImprovements = (await getReviews(shiftMonth(from, -1), shiftMonth(from, -1)))
    .filter((r) => r.kind === "month")
    .flatMap((r) => r.improvements.filter((x) => !x.done));

  return (
    <>
      <header className="appbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-face-96.png" alt="しっぽり亭" width={96} height={96} className="appbar__logo" />
        <Link className="btn btn-sm" href={`/haccp/month?m=${fmtYm(shiftMonth(from, -1))}`} aria-label="前の月">‹</Link>
        <div className="appbar__title">衛生 {fmtMonthJa(from)}</div>
        <Link className="btn btn-sm" href={`/haccp/month?m=${fmtYm(shiftMonth(from, 1))}`} aria-label="次の月">›</Link>
      </header>
      <HaccpTabs current="month" canManage />

      <div className="wrap stack">
        <section className="summary">
          <span>記録完了 <strong>{counts.complete}</strong>日</span>
          <span>一部未完了 <strong>{counts.partial}</strong>日</span>
          <span>未記録 <strong>{counts.none}</strong>日</span>
          <span>休業 <strong>{counts.closed}</strong>日</span>
          <span>対応中の異常 <strong>{openAll.length}</strong>件</span>
        </section>

        <h2 className="section-title">日ごとの状態</h2>
        <p className="micro">「記録」と「問題への対応」は別に見ています（記録が揃っていても対応中の異常があれば赤く出ます）。</p>
        <div className="hc-month">
          {monthDays.map(([d, s]) => {
            const dow = weekdayOf(d);
            return (
              <Link key={d} href={`/haccp?d=${d}`} className={`hc-day hc-day--${s.state}${s.open ? " hc-day--open" : ""}`}>
                <span className="hc-day__d">{Number(d.slice(8))}<small>{WEEKDAY_JA[dow]}</small></span>
                <span className="hc-day__s">{DAY_STATE_LABEL[s.state]}</span>
                {s.state === "partial" ? <span className="hc-day__x">残{s.required - s.filled}</span> : null}
                {s.ng ? <span className="hc-day__x">問題{s.ng}</span> : null}
                {s.open ? <span className="hc-day__x">対応中{s.open}</span> : null}
              </Link>
            );
          })}
        </div>

        {missing.length ? (
          <section className="hc-alert" role="alert">
            <strong>未記録・一部未完了の日：</strong>
            {missing.map(([d]) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`).join("、")}
          </section>
        ) : null}

        {repeats.length ? (
          <section className="card stack">
            <h2 className="section-title" style={{ margin: 0 }}>繰り返している問題</h2>
            {repeats.map(([k, n]) => <div key={k}>{k}：{n}回</div>)}
          </section>
        ) : null}

        {openAll.length ? (
          <section className="card stack">
            <h2 className="section-title" style={{ margin: 0 }}>対応中の異常（担当・期限）</h2>
            {openAll.map((i) => (
              <Link key={i.id} href="/haccp/incidents" className="micro">
                {i.biz_date}　{i.target}：{i.problem}　担当 {names.get(i.handler_id ?? "") ?? "未定"}　期限 {i.due_on ?? "未定"}
                {i.due_on && i.due_on < today ? "（過ぎています）" : ""}
              </Link>
            ))}
          </section>
        ) : null}

        <h2 className="section-title">週ごとの記録確認</h2>
        {weeks.map((w) => {
          const end = shiftDate(w, 6);
          const r = reviewOf("week", w);
          const ws = [...days.entries()].filter(([d]) => d >= w && d <= end);
          const miss = ws.filter(([, s]) => s.alert).length;
          const ng = ws.reduce((a, [, s]) => a + s.ng, 0);
          return (
            <section key={w} className="card stack">
              <div className="row" style={{ flexWrap: "wrap" }}>
                <strong>{Number(w.slice(5, 7))}/{Number(w.slice(8))}〜{Number(end.slice(5, 7))}/{Number(end.slice(8))}</strong>
                <span className="micro">未記録・一部 {miss}日／問題 {ng}件</span>
                {r ? <span className="hc-pill hc-pill--ok">確認済み {names.get(r.reviewer_id) ?? "?"}</span> : <span className="hc-pill hc-pill--todo">未確認</span>}
              </div>
              {end < today || w <= today ? <ReviewForm kind="week" start={w} end={end} review={r} /> : null}
            </section>
          );
        })}

        <h2 className="section-title">月の振り返り</h2>
        {prevMonthImprovements.length ? (
          <section className="notice">
            先月の改善事項で終わっていないもの：
            {prevMonthImprovements.map((x) => `${x.task}（${x.owner || "担当未定"}・${x.due || "期限未定"}）`).join("、")}
          </section>
        ) : null}
        <section className="card stack">
          <ReviewForm kind="month" start={from} end={to} review={monthReview} withImprovements />
        </section>

        <h2 className="section-title">出力（印刷・PDF・CSV）</h2>
        <section className="card stack">
          <p className="micro">印刷画面から「PDFとして保存」で PDF になります。未記録の欄は空欄（未記録）のまま出ます。</p>
          {[
            ["plan", "衛生管理計画"],
            ["general", "一般衛生管理の記録（月別）"],
            ["temps", "設備別の温度記録"],
            ["critical", "重要管理の記録"],
            ["incidents", "異常と改善対応"],
            ["reviews", "確認・振り返りの記録"],
          ].map(([k, label]) => (
            <div key={k} className="row" style={{ flexWrap: "wrap" }}>
              <span style={{ flex: 1 }}>{label}</span>
              <Link className="btn btn-sm" href={`/haccp/print?type=${k}&m=${ym}`}>印刷・PDF</Link>
              {k !== "plan" ? (
                <a className="btn btn-sm" href={`/api/haccp/csv?type=${k}&m=${ym}`}>CSV</a>
              ) : null}
            </div>
          ))}
          <div className="row" style={{ flexWrap: "wrap" }}>
            <span style={{ flex: 1 }}>手書き用の記録用紙（空欄・この月）</span>
            <Link className="btn btn-sm" href={`/haccp/print?type=general&m=${ym}&blank=1`}>印刷・PDF</Link>
          </div>
        </section>
      </div>
      <div style={{ height: "4rem" }} />
    </>
  );
}
