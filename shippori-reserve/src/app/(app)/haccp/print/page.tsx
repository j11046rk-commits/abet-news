import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { fmtYm, todayBizDate } from "@/lib/time";
import { getPlans } from "@/lib/haccp-data";
import { buildReport, REPORT_TITLE, type ReportType } from "@/lib/haccp-report";
import { getProfileNames } from "@/lib/queries";
import { mdhm } from "@/lib/haccp-time";
import PlanView from "../PlanView";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

const TYPES = ["plan", "general", "temps", "critical", "incidents", "reviews"] as const;

/**
 * 印刷用の帳票（ブラウザの印刷から「PDFとして保存」で PDF にもなる）。
 * 文字は端末の日本語フォントで描くので、外部のPDFサービスは使わない。
 */
export default async function PrintPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; m?: string; v?: string; blank?: string }>;
}) {
  const me = await requirePermission("haccp.manage");
  const sp = await searchParams;
  const type = (TYPES as readonly string[]).includes(sp.type ?? "") ? (sp.type as (typeof TYPES)[number]) : "general";
  const ym = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : fmtYm(todayBizDate());
  const printedAt = mdhm(new Date().toISOString());

  if (type === "plan") {
    const [plans, names] = await Promise.all([getPlans(), getProfileNames()]);
    const plan = (sp.v ? plans.find((p) => String(p.version) === sp.v) : plans.find((p) => p.status === "approved")) ?? null;
    return (
      <div className="print-sheet">
        <div className="print-bar no-print">
          <Link className="btn btn-sm" href="/haccp/plan">戻る</Link>
          <PrintButton />
        </div>
        {!plan || plan.status === "draft" ? (
          <p>印刷できる承認済みの計画がありません。</p>
        ) : (
          <>
            <h1>{REPORT_TITLE.plan}（第{plan.version}版）</h1>
            <table className="print-meta">
              <tbody>
                <tr><th>店舗</th><td>{plan.store_name}</td><th>食品衛生責任者</th><td>{plan.hygiene_manager}</td></tr>
                <tr><th>計画作成者</th><td>{plan.author_name}</td><th>承認者</th><td>{names.get(plan.approved_by ?? "") ?? ""}（{mdhm(plan.approved_at)}）</td></tr>
                <tr><th>適用開始日</th><td>{plan.effective_from}</td><th>出力日</th><td>{printedAt}（{me.display_name}）</td></tr>
                {plan.change_reason ? <tr><th>変更理由</th><td colSpan={3}>{plan.change_reason}</td></tr> : null}
              </tbody>
            </table>
            <PlanView content={plan.content} />
          </>
        )}
      </div>
    );
  }

  const r = await buildReport(type as ReportType, ym, { blank: sp.blank === "1" });
  return (
    <div className="print-sheet">
      <div className="print-bar no-print">
        <Link className="btn btn-sm" href={`/haccp/month?m=${ym}`}>戻る</Link>
        <PrintButton />
        {!sp.blank ? <a className="btn btn-sm" href={`/api/haccp/csv?type=${type}&m=${ym}`}>CSV</a> : null}
      </div>
      <h1>{r.title}{sp.blank === "1" ? "（手書き用）" : ""}</h1>
      <table className="print-meta">
        <tbody>
          <tr><th>店舗</th><td>{r.store}</td><th>対象期間</th><td>{r.period}</td></tr>
          <tr><th>出力日</th><td>{printedAt}（{me.display_name}）</td><th>確認者</th><td className="print-sign"></td></tr>
        </tbody>
      </table>
      <table className="print-table">
        <thead>
          <tr>{r.columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {r.rows.length === 0 ? (
            <tr><td colSpan={r.columns.length}>この期間の記録はありません。</td></tr>
          ) : (
            r.rows.map((row, i) => (
              <tr key={i}>
                {row.map((v, j) => (
                  <td key={j} className={v === "未記録" ? "print-miss" : v === "問題あり" || v === "基準外" ? "print-ng" : ""}>{v ?? ""}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {r.notes.map((n) => <p key={n} className="print-note">{n}</p>)}
    </div>
  );
}
