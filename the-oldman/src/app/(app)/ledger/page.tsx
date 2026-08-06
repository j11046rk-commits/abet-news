import type { Metadata } from "next";
import Link from "next/link";
import LedgerClient from "./LedgerClient";
import MonthlyChart from "@/components/MonthlyChart";
import { requireProfile } from "@/lib/auth";
import { getVault } from "@/lib/dashboard";
import { yen } from "@/lib/money";
import { getFixedCosts, getLedgerEntries, getMonthlySummary, getProfiles } from "@/lib/queries";
import { fmtYm, nowJst } from "@/lib/time";

export const metadata: Metadata = { title: "台帳 — The Oldman" };
export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  const [profile, entries, monthly, fixedCosts, vault, profiles] = await Promise.all([
    requireProfile(),
    getLedgerEntries(),
    getMonthlySummary(),
    getFixedCosts(),
    getVault(),
    getProfiles(),
  ]);

  const ym = fmtYm(nowJst());
  const current = monthly.find((m) => m.ym === ym);
  const balance = current?.balance_yen ?? vault.carryover;

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

      {vault.breakEvenMonth ? (
        <p className="notice notice-strong lsum__warn">
          この収支のままだと {vault.breakEvenMonth.replace("-", "年 ")}月 に残高がゼロを割ります。
        </p>
      ) : null}

      <div className="rule">
        <span className="label">Monthly</span>
      </div>

      <MonthlyChart rows={monthly} />

      <LedgerClient
        isOwner={profile.role === "owner"}
        entries={entries}
        fixedCosts={fixedCosts}
        currentYm={ym}
        names={Object.fromEntries(profiles.map((p) => [p.id, p.display_name]))}
      />

      {/* メンバーと設定はタブから外した。使う頻度が低いのでここから入る。 */}
      <nav className="backdoor">
        <Link href="/members" className="micro">
          メンバー・貸切時間 →
        </Link>
        {profile.role === "owner" ? (
          <Link href="/settings" className="micro">
            施設の設定 →
          </Link>
        ) : null}
      </nav>
    </>
  );
}
