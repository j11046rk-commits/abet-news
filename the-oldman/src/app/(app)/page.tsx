import Link from "next/link";
import VaultGauge from "@/components/VaultGauge";
import WeekStrip from "@/components/WeekStrip";
import { requireProfile } from "@/lib/auth";
import { getVault } from "@/lib/dashboard";
import { yen } from "@/lib/money";
import {
  getProfiles,
  getReservationsBetween,
  getSessionPlayerNames,
  getSessions,
} from "@/lib/queries";
import { addDaysJst, fmtDate, fmtDateJa, jstHourToIso, nowJst, startOfWeekJst } from "@/lib/time";
import { gameTypeJa } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const weekStart = fmtDate(startOfWeekJst(nowJst()));
  const weekEnd = fmtDate(addDaysJst(startOfWeekJst(nowJst()), 7));

  const [, vault, sessions, weekReservations, profiles] = await Promise.all([
    requireProfile(),
    getVault(),
    getSessions(3),
    getReservationsBetween(jstHourToIso(weekStart, 0), jstHourToIso(weekEnd, 0)),
    getProfiles(),
  ]);

  const playerNames = await getSessionPlayerNames(sessions.map((s) => s.id));
  const names = Object.fromEntries(profiles.map((p) => [p.id, p.display_name]));
  const reached = vault.shortfall === 0;

  return (
    <>
      <VaultGauge saved={vault.saved} target={vault.target} />

      {/*
        この施設が知りたいことは1つだけ。
        KPIカードを4枚並べず、文章に近い密度の1ブロックとして従属させる（DESIGN.md §9-2）。
      */}
      <section className={`recovery${reached ? " is-reached" : ""}`}>
        {reached ? (
          <p className="recovery__lead">
            今月の目標に達しました。<span className="dim">超過分は繰越に積まれます。</span>
          </p>
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
                <li className="dim">まだ平均レーキを計算できません。セッションを記録してください。</li>
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
        <span className="label">Recent tables</span>
      </div>

      {sessions.length === 0 ? (
        <p className="empty">まだ記録がありません。今夜の卓から始めましょう。</p>
      ) : (
        <ul className="recent">
          {sessions.map((s) => (
            <li key={s.id} className="recent__row">
              <span className="recent__date mincho">{fmtDateJa(s.started_at)}</span>
              <span className="micro">{gameTypeJa(s.game_type)}</span>
              <span className="micro">{playerNames.get(s.id)?.length ?? 0}名</span>
              <span className="recent__rake amount">{yen(s.rake_yen)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="rule">
        <span className="label">This week</span>
        <Link href="/calendar" className="micro rule__link">
          カレンダー →
        </Link>
      </div>

      <WeekStrip weekStart={weekStart} reservations={weekReservations} names={names} />
    </>
  );
}
