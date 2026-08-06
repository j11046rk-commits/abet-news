import type { Metadata } from "next";
import LedgerClient from "./LedgerClient";
import MonthlyChart from "@/components/MonthlyChart";
import { requireProfile } from "@/lib/auth";
import { getVault } from "@/lib/dashboard";
import { yen } from "@/lib/money";
import { getFixedCosts, getLedgerEntries, getMonthlySummary } from "@/lib/queries";
import { fmtYm, nowJst } from "@/lib/time";

export const metadata: Metadata = { title: "台帳 — The Oldman" };
export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  const [profile, entries, monthly, fixedCosts, vault] = await Promise.all([
    requireProfile(),
    getLedgerEntries(),
    getMonthlySummary(),
    getFixedCosts(),
    getVault(),
  ]);

  const ym = fmtYm(nowJst());
  const current = monthly.find((m) => m.ym === ym);

  return (
    <>
      <header className="page">
        <h1 className="display">台帳</h1>
        <p className="dim page__lead">
          全員が読めます。記帳と固定費の設定はオーナーのみ。
        </p>
      </header>

      <div className="rule">
        <span className="label">Ledger — {ym.replace("-", " / ")}</span>
      </div>

      <div className="lsum">
        <div>
          <span className="label">今月の収入</span>
          <span className="lsum__num amount">{yen(current?.income_yen ?? 0)}</span>
        </div>
        <div>
          <span className="label">今月の支出</span>
          <span className="lsum__num amount is-expense">{yen(current?.expense_yen ?? 0)}</span>
        </div>
        <div>
          <span className="label">累計残高</span>
          <span className={`lsum__num amount${(current?.balance_yen ?? 0) < 0 ? " is-expense" : ""}`}>
            {yen(current?.balance_yen ?? vault.carryover)}
          </span>
        </div>
      </div>

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
      />
    </>
  );
}
