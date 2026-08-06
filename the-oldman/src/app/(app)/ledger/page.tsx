import type { Metadata } from "next";
import Link from "next/link";
import Advances from "./Advances";
import LedgerClient from "./LedgerClient";
import Passbook from "./Passbook";
import MonthlyChart from "@/components/MonthlyChart";
import YearlyRake from "@/components/YearlyRake";
import { requireProfile } from "@/lib/auth";
import { getVault } from "@/lib/dashboard";
import { yen } from "@/lib/money";
import {
  getAdvances,
  getLedgerMonths,
  getMonthlySummary,
  getPassbook,
  getProfiles,
} from "@/lib/queries";
import { fmtYm, nowJst } from "@/lib/time";

export const metadata: Metadata = { title: "台帳 — The Oldmans" };
export const dynamic = "force-dynamic";

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const thisYm = fmtYm(nowJst());
  const requested = (await searchParams).ym;
  const ym = requested && /^\d{4}-\d{2}$/.test(requested) ? requested : thisYm;

  const [profile, monthly, months, passbook, vault, profiles, advances] =
    await Promise.all([
      requireProfile(),
      getMonthlySummary(),
      getLedgerMonths(),
      getPassbook(ym),
      getVault(),
      getProfiles(),
      getAdvances(ym),
    ]);

  // 月送りは「記帳のある月」と「今月」のあいだを行き来する。
  // 記帳が一度も無い月に迷い込んで空の画面が続くのを避ける。
  const timeline = Array.from(new Set([...months, thisYm, ym])).sort();
  const at = timeline.indexOf(ym);

  const current = monthly.find((m) => m.ym === thisYm);
  // TOP と同じ数字を出す。残高の出しかたは getVault に1本化してある。
  const balance = vault.balance;

  return (
    <>
      {/* 台帳を開いていちばん知りたいのは残高。だから最初に、いちばん大きく。 */}
      <section className="balance">
        <p className="label">残高</p>
        <p className={`balance__num${balance < 0 ? " is-negative" : ""}`}>
          {balance < 0 ? `−${yen(Math.abs(balance))}` : yen(balance)}
        </p>
        <p className="micro balance__sub">
          今月分の収入 {yen(current?.income_yen ?? 0)} · 支出 {yen(current?.expense_yen ?? 0)}
        </p>
      </section>

      {/* 毎月かならず来るのに金額が変わる費目。抜けたまま月をまたぐのがいちばん困る。 */}
      {vault.missingMetered.length > 0 ? (
        <p className="notice notice-strong lsum__warn">
          今月分の {vault.missingMetered.map((c) => c.ja).join("と")} がまだ記帳されていません。
        </p>
      ) : null}

      {vault.breakEvenMonth ? (
        <p className="notice notice-strong lsum__warn">
          この収支のままだと {vault.breakEvenMonth.replace("-", "年 ")}月 に残高がゼロを割ります。
        </p>
      ) : null}

      <Passbook
        ym={ym}
        opening={passbook.opening}
        rows={passbook.rows}
        prevYm={at > 0 ? timeline[at - 1] : null}
        nextYm={at >= 0 && at < timeline.length - 1 ? timeline[at + 1] : null}
        names={Object.fromEntries(profiles.map((p) => [p.id, p.display_name]))}
      />

      <LedgerClient rows={passbook.rows} />

      <Advances
        advances={advances}
        profiles={profiles.map((p) => ({ id: p.id, name: p.display_name }))}
        meId={profile.id}
      />

      <div className="rule">
        <span className="label">Monthly</span>
      </div>

      <MonthlyChart rows={monthly} />

      <div className="rule">
        <span className="label">Yearly</span>
      </div>

      {/* 直近12ヶ月の運営積立。目標に届いた月がどれだけあるかを一目で。 */}
      <YearlyRake rows={monthly} target={vault.target} currentYm={thisYm} />

      {/* 設定はタブから外した。固定費もここから入る。 */}
      {profile.role === "owner" ? (
        <nav className="backdoor">
          <Link href="/settings" className="micro">
            施設の設定・固定費 →
          </Link>
        </nav>
      ) : null}
    </>
  );
}
