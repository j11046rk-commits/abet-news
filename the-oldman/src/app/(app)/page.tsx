import Link from "next/link";
import Visits from "@/components/Visits";
import WhiskyGauge from "@/components/WhiskyGauge";
import WeekStrip from "@/components/WeekStrip";
import { requireProfile } from "@/lib/auth";
import { getVault } from "@/lib/dashboard";
import { yen } from "@/lib/money";
import {
  getOpenCheckIns,
  getProfiles,
  getRecentCheckIns,
  getReservationsBetween,
  getSessions,
  getSessionsBetween,
} from "@/lib/queries";
import {
  addDaysJst,
  fmtDate,
  fmtDateJa,
  fmtTime,
  jstHourToIso,
  nowJst,
  startOfWeekJst,
} from "@/lib/time";
import { purposeMeta } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Top() {
  const weekStart = fmtDate(startOfWeekJst(nowJst()));
  const weekEnd = fmtDate(addDaysJst(startOfWeekJst(nowJst()), 7));

  const [
    me,
    vault,
    sessions,
    weekReservations,
    weekSessions,
    profiles,
    openCheckIns,
    recentCheckIns,
  ] = await Promise.all([
    requireProfile(),
    getVault(),
    getSessions(3),
    getReservationsBetween(jstHourToIso(weekStart, 0), jstHourToIso(weekEnd, 0)),
    getSessionsBetween(jstHourToIso(weekStart, 0), jstHourToIso(weekEnd, 0)),
    getProfiles(),
    getOpenCheckIns(),
    getRecentCheckIns(8),
  ]);

  const names = Object.fromEntries(profiles.map((p) => [p.id, p.display_name]));
  const reached = vault.shortfall === 0;

  return (
    <>
      {/* 毎月かならず来るのに金額が変わる費目。抜けたまま月をまたぐのがいちばん困る。 */}
      {vault.missingMetered.length > 0 ? (
        <p className="notice notice-strong">
          今月分の {vault.missingMetered.map((c) => c.ja).join("と")} が未記帳です。
          <Link href="/ledger" className="micro">
            {" "}
            台帳へ →
          </Link>
        </p>
      ) : null}

      {/* いま施設に誰がいるか。最初に見えるべきはこれ。 */}
      <section className="now">
        <div className="rule now__rule">
          <span className="label">Now</span>
        </div>
        {openCheckIns.length === 0 ? (
          <p className="now__empty">
            いま施設にいる人はいません。<span className="dim">着いたらチェックインしてください。</span>
          </p>
        ) : (
          <>
            {/* 人数は連れを含めた合計。会員の数ではなく、いま中にいる人の数を出す。 */}
            <p className="now__count">
              <span className="now__num amount">
                {openCheckIns.reduce((n, c) => n + (c.headcount || 1), 0)}
              </span>
              <span className="now__unit">名が滞在中</span>
            </p>
            <ul className="now__list">
              {openCheckIns.map((c) => (
                <li key={c.id} className="now__item">
                  <span className="now__name">
                    {names[c.profile_id] ?? "メンバー"}
                    {c.headcount > 1 ? <span className="micro"> +{c.headcount - 1}</span> : null}
                  </span>
                  <span className="now__what micro">
                    {(c.purposes ?? []).map((p) => purposeMeta(p).ja).join("・")}
                    {c.memo ? ` · ${c.memo}` : ""}
                  </span>
                  <span className="micro amount">{fmtTime(c.checked_in_at)}〜</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <WhiskyGauge saved={vault.saved} target={vault.target} />

      {/* いちばん多い操作。ゲージのすぐ下、金額を読んだ流れで押せる位置に置く。 */}
      <Link href="/sessions?new=1" className="btn btn-primary block record">
        レーキを記録する
      </Link>

      <section className={`recovery${reached ? " is-reached" : ""}`}>
        {reached ? (
          <>
            <p className="recovery__lead">今月の家賃は賄えました。</p>
            <ul className="recovery__list">
              <li>
                目標 <span className="amount">{yen(vault.target)}</span> に対して{" "}
                <span className="amount">{yen(vault.saved)}</span>
              </li>
              {vault.surplus > 0 ? (
                <li>
                  余剰 <span className="recovery__amount amount">{yen(vault.surplus)}</span>{" "}
                  は施設に供託されます。
                </li>
              ) : null}
            </ul>
          </>
        ) : (
          <>
            <p className="recovery__lead">
              あと <span className="recovery__amount amount">{yen(vault.shortfall)}</span>
            </p>
            <ul className="recovery__list">
              {vault.avgRake && vault.sessionsNeeded ? (
                <li>
                  平均レーキ <span className="amount">{yen(vault.avgRake)}</span>/回 →{" "}
                  <strong className="recovery__strong amount">あと{vault.sessionsNeeded}回</strong>
                  の開催で達成
                </li>
              ) : (
                <li className="dim">まだ平均レーキを計算できません。レーキを記録してください。</li>
              )}
              <li>
                今月残り <span className="amount">{vault.daysLeft}</span> 日
              </li>
              <li>
                このまま不足した場合、1人あたり{" "}
                <span className="amount recovery__claret">{yen(vault.perOwner)}</span>
                <span className="micro"> （{vault.ownerCount}名で分担）</span>
              </li>
            </ul>
          </>
        )}
      </section>

      <div className="rule">
        <span className="label">Recent visits</span>
      </div>

      <Visits visits={recentCheckIns} names={names} meId={me.id} />

      <div className="rule">
        <span className="label">Recent tables</span>
        <Link href="/sessions" className="micro rule__link">
          記録 →
        </Link>
      </div>

      {sessions.length === 0 ? (
        <p className="empty">まだ記録がありません。今夜の卓から始めましょう。</p>
      ) : (
        <ul className="recent">
          {sessions.map((s) => (
            <li key={s.id} className="recent__row">
              <span className="recent__date mincho">{fmtDateJa(s.started_at)}</span>
              <span className="micro">{s.headcount}名</span>
              <span className="micro">
                {s.created_by ? (names[s.created_by] ?? "—") : "—"}
              </span>
              <span className="recent__rake amount">{yen(s.rake_yen)}</span>
            </li>
          ))}
        </ul>
      )}

      <section className="carry">
        <span className="label">繰越残高</span>
        <span className={`carry__amount amount${vault.carryover < 0 ? " is-negative" : ""}`}>
          {vault.carryover < 0 ? `−${yen(Math.abs(vault.carryover))}` : yen(vault.carryover)}
        </span>
        {vault.breakEvenMonth ? (
          <p className="notice notice-strong carry__warn">
            この収支のままだと {vault.breakEvenMonth.replace("-", "年 ")}月 に残高がゼロを割ります。
          </p>
        ) : null}
      </section>

      <div className="rule">
        <span className="label">This week</span>
        <Link href="/calendar" className="micro rule__link">
          カレンダー →
        </Link>
      </div>

      <WeekStrip
        weekStart={weekStart}
        reservations={weekReservations}
        sessions={weekSessions}
        names={names}
      />
    </>
  );
}
