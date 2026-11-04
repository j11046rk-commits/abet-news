import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/constants";
import { getProfileNames } from "@/lib/queries";
import { fmtDateJa, shiftDate, todayBizDate } from "@/lib/time";
import { DAY_STATE_LABEL, planForDate } from "@/lib/haccp";
import {
  getAcks,
  getBatches,
  getChecks,
  getClosedDays,
  getDayCloses,
  getDaysHaccp,
  getIncidents,
  getPlans,
} from "@/lib/haccp-data";
import HaccpDay from "./HaccpDay";
import HaccpTabs from "./HaccpTabs";
import AckButton from "./AckButton";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 衛生管理：今日のチェック（スマホで毎日使う画面）。
 * ?d=YYYY-MM-DD で過去の日を開くと「追記」になる（実施日時と入力日時を分けて残す）。
 */
export default async function HaccpPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const me = await requirePermission("haccp.record");
  const sp = await searchParams;
  const today = todayBizDate();
  const date = DATE_RE.test(sp.d ?? "") && sp.d! <= today ? sp.d! : today;
  const canManage = can(me.role, "haccp.manage");

  const [plans, closed, checks, batches, closes, names, openIncidents] = await Promise.all([
    getPlans(),
    getClosedDays(date, date),
    getChecks(date, date),
    getBatches(date, date),
    getDayCloses(date, date),
    getProfileNames(),
    getIncidents({ openOnly: true }),
  ]);
  const plan = planForDate(plans, date);
  const current = plans.find((p) => p.status === "approved") ?? null;
  const draft = plans.find((p) => p.status === "draft") ?? null;
  const acks = current ? await getAcks([current.id]) : [];
  const acked = acks.some((a) => a.profile_id === me.id);

  // 直近2週間で記録が揃っていない日（今日は含めない）
  const recent = await getDaysHaccp(shiftDate(today, -14), shiftDate(today, -1), today, { plans });
  const missing = [...recent.entries()].filter(([, d]) => d.alert).map(([d, s]) => ({ date: d, s }));

  return (
    <>
      <header className="appbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-face-96.png" alt="しっぽり亭" width={96} height={96} className="appbar__logo" />
        <Link className="btn btn-sm" href={`/haccp?d=${shiftDate(date, -1)}`} aria-label="前の日">‹</Link>
        <div className="appbar__title">
          衛生管理 {fmtDateJa(`${date}T12:00:00+09:00`)}
          {date === today ? "" : "（追記）"}
        </div>
        {date < today ? (
          <Link className="btn btn-sm" href={`/haccp?d=${shiftDate(date, 1)}`} aria-label="次の日">›</Link>
        ) : null}
      </header>
      <HaccpTabs current="day" canManage={canManage} />

      <div className="wrap stack" style={{ paddingBottom: 0 }}>
        {missing.length > 0 ? (
          <section className="hc-alert" role="alert">
            <strong>⚠ 衛生チェックが済んでいない日があります</strong>
            <div className="chips" style={{ marginTop: "0.4rem" }}>
              {missing.map(({ date: d, s }) => (
                <Link key={d} className="chip" href={`/haccp?d=${d}`}>
                  {Number(d.slice(5, 7))}/{Number(d.slice(8))} {DAY_STATE_LABEL[s.state]}
                  {s.state === "partial" ? `（残り${s.required - s.filled}）` : ""}
                </Link>
              ))}
            </div>
          </section>
        ) : null}
        {openIncidents.length > 0 ? (
          <Link className="hc-alert hc-alert--warn" href="/haccp/incidents">
            対応中の異常が {openIncidents.length} 件あります → 異常・改善
          </Link>
        ) : null}
        {current && !acked ? (
          <section className="notice">
            衛生管理計画（第{current.version}版）を読んだら、確認の記録を付けてください。
            <div style={{ marginTop: "0.5rem" }} className="row">
              <Link className="btn btn-sm" href="/haccp/plan">計画を読む</Link>
              <AckButton planId={current.id} />
            </div>
          </section>
        ) : null}
        {draft && canManage ? (
          <Link className="notice" href="/haccp/plan">
            計画の下書き（第{draft.version}版）があります。確定するまで、毎日のチェックは今の計画のままです。
          </Link>
        ) : null}
      </div>

      <HaccpDay
        date={date}
        today={today}
        isClosed={closed.has(date)}
        plan={plan ? { id: plan.id, version: plan.version, content: plan.content } : null}
        checks={checks}
        batches={batches}
        dayClose={closes[0] ?? null}
        names={Object.fromEntries(names)}
        meId={me.id}
        canManage={canManage}
      />
      <div style={{ height: "2rem" }} />
    </>
  );
}
