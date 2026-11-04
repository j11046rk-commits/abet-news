import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { getProfileNames } from "@/lib/queries";
import { getRevisions } from "@/lib/haccp-data";
import { mdhm } from "@/lib/haccp-time";
import { RESULT_LABEL } from "@/lib/haccp";

export const dynamic = "force-dynamic";

const TABLES = ["haccp_checks", "haccp_batches", "haccp_incidents", "haccp_reviews"];
const LABEL: Record<string, string> = {
  result: "結果", temp_c: "温度", measured_at: "実施日時", note: "内容", action: "対応", vals: "測定値",
  item_name: "品名", judgement: "判定", storage_place: "保存先", use_by: "使用期限", cooked_at: "調理日時",
  status: "状態", recheck_result: "再確認", recheck_note: "再確認の内容", dispositions: "処置", prevention: "改善",
  handler_id: "担当者", due_on: "期限", comment: "コメント", improvements: "改善事項",
};
const SKIP = new Set(["updated_at", "updated_by", "revision", "edit_reason", "confirmed_at", "confirmer_id", "summary"]);

/** 修正の履歴（直す前と後・理由・誰が・いつ） */
export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ t?: string; id?: string }> }) {
  await requirePermission("haccp.record");
  const sp = await searchParams;
  const ok = TABLES.includes(sp.t ?? "") && /^[0-9a-f-]{36}$/.test(sp.id ?? "");
  const [revs, names] = ok ? await Promise.all([getRevisions(sp.t!, sp.id!), getProfileNames()]) : [[], new Map<string, string>()];
  const CODE: Record<string, string> = {
    ...RESULT_LABEL, pending: "途中", open: "対応中", done: "対応済み",
  };
  const show = (k: string, v: unknown) => {
    if (v == null || v === "") return "（空）";
    if ((k === "result" || k === "judgement" || k === "status" || k === "recheck_result") && typeof v === "string") return CODE[v] ?? v;
    if (k === "handler_id" && typeof v === "string") return names.get(v) ?? v;
    if (k.endsWith("_at") && typeof v === "string") return mdhm(v);
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  };
  return (
    <>
      <header className="appbar">
        <Link className="btn btn-sm" href="/haccp">‹ 戻る</Link>
        <div className="appbar__title">修正の履歴</div>
      </header>
      <div className="wrap stack">
        {revs.length === 0 ? <p className="micro">修正の履歴はありません。</p> : null}
        {revs.map((r) => {
          const changed = Object.keys(r.after ?? {}).filter(
            (k) => !SKIP.has(k) && JSON.stringify(r.before?.[k]) !== JSON.stringify(r.after?.[k]),
          );
          return (
            <section key={r.id} className="card stack">
              <div className="micro">
                {mdhm(r.changed_at)}　{names.get(r.changed_by ?? "") ?? "?"}
                {r.reason ? `　理由：${r.reason}` : ""}
              </div>
              {changed.map((k) => (
                <div key={k}>
                  {LABEL[k] ?? k}：<s className="muted">{show(k, r.before?.[k])}</s> → {show(k, r.after?.[k])}
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
