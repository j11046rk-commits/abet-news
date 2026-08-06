"use client";

import Link from "next/link";
import { yen } from "@/lib/money";
import { categoryJa, type PassbookRow } from "@/lib/types";

/**
 * 通帳。銀行の明細と同じ読み方ができることだけを狙っている。
 *
 * ・新しい順（開いてまず見たいのは直近の1行）
 * ・残高は古い順に積み上げてから並べ替える。表示の向きで数字は変わらない
 * ・いちばん下に前月繰越、いちばん上に当月計
 * ・入金と出金は別の列。同じ列に符号で混ぜない
 * ・数字は桁幅を揃えて右揃え。桁が縦に揃わないと通帳にならない
 */
export default function Passbook({
  ym,
  opening,
  rows,
  prevYm,
  nextYm,
  names,
}: {
  ym: string;
  opening: number;
  rows: PassbookRow[];
  prevYm: string | null;
  nextYm: string | null;
  names: Record<string, string>;
}) {
  const [y, m] = ym.split("-");
  const income = rows.filter((r) => r.direction === "income").reduce((s, r) => s + r.amount_yen, 0);
  const expense = rows.filter((r) => r.direction === "expense").reduce((s, r) => s + r.amount_yen, 0);
  const closing = rows.length ? rows[rows.length - 1].balance_yen : opening;
  // 残高は古い順に積んである。並べ替えるのは見せ方だけ。
  const shown = [...rows].reverse();

  return (
    <>
      <div className="pb__nav">
        {prevYm ? (
          <Link href={`/ledger?ym=${prevYm}`} className="pb__arrow" aria-label="前の月">
            ‹
          </Link>
        ) : (
          <span className="pb__arrow is-off" aria-hidden>
            ‹
          </span>
        )}
        <span className="pb__ym mincho">
          {y}年 {Number(m)}月
        </span>
        {nextYm ? (
          <Link href={`/ledger?ym=${nextYm}`} className="pb__arrow" aria-label="次の月">
            ›
          </Link>
        ) : (
          <span className="pb__arrow is-off" aria-hidden>
            ›
          </span>
        )}
      </div>

      <div className="pb__scroll">
        <table className="pb">
          <thead>
            <tr>
              <th className="pb__c-date">日付</th>
              <th className="pb__c-name">名目</th>
              <th className="pb__c-num">入金</th>
              <th className="pb__c-num">出金</th>
              <th className="pb__c-num">残高</th>
            </tr>
          </thead>
          <tbody>
            <tr className="pb__sum">
              <td className="pb__c-date" />
              <td className="pb__c-name">当月計</td>
              <td className="pb__c-num amount">{income ? yen(income) : ""}</td>
              <td className="pb__c-num amount is-expense">{expense ? yen(expense) : ""}</td>
              <td className="pb__c-num amount">{signed(closing)}</td>
            </tr>

            {shown.map((r) => (
              <tr key={r.id}>
                <td className="pb__c-date amount">{Number(r.entry_date.slice(8))}</td>
                <td className="pb__c-name">
                  {r.memo?.trim() || categoryJa(r.direction, r.category)}
                  {/*
                    出どころを添える。レーキは名目に「レーキ」と出ているので何も足さない。
                    足すと、通帳のいちばん多い行に毎回同じ字が並ぶだけになる。
                  */}
                  <span className="pb__by">
                    {r.session_id
                      ? ""
                      : r.fixed_cost_id
                        ? "自動"
                        : r.advance_id
                          ? `立替 · ${r.created_by ? (names[r.created_by] ?? "") : ""}`
                          : r.created_by
                            ? (names[r.created_by] ?? "")
                            : ""}
                  </span>
                </td>
                <td className="pb__c-num amount">
                  {r.direction === "income" ? yen(r.amount_yen) : ""}
                </td>
                <td className="pb__c-num amount is-expense">
                  {r.direction === "expense" ? yen(r.amount_yen) : ""}
                </td>
                <td className="pb__c-num amount">{signed(r.balance_yen)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="pb__carry">
              <td className="pb__c-date">1</td>
              <td className="pb__c-name">前月繰越</td>
              <td className="pb__c-num" />
              <td className="pb__c-num" />
              <td className="pb__c-num amount">{signed(opening)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {rows.length === 0 ? <p className="empty">この月の記帳はありません。</p> : null}
    </>
  );
}

function signed(v: number) {
  return v < 0 ? `−${yen(Math.abs(v))}` : yen(v);
}
