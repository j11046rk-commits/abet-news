"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReviewRow } from "@/lib/haccp-data";
import { saveReview } from "../actions";

export default function ReviewForm({
  kind,
  start,
  end,
  review,
  withImprovements,
}: {
  kind: "week" | "month";
  start: string;
  end: string;
  review: ReviewRow | null;
  withImprovements?: boolean;
}) {
  const router = useRouter();
  const [pending, startT] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [comment, setComment] = useState(review?.comment ?? "");
  const [repeat, setRepeat] = useState(review?.repeat_issues ?? "");
  const [planReview, setPlanReview] = useState(review?.plan_review_needed ?? false);
  const [imps, setImps] = useState(review?.improvements?.length ? review.improvements : [{ task: "", owner: "", due: "", done: false }]);
  return (
    <div className="stack">
      <textarea
        className="field"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={kind === "week" ? "記録を見て気づいたこと（例：月曜の営業前の記録漏れが続いた）" : "この月の振り返り（できたこと・続いた問題・気づき）"}
        aria-label={kind === "week" ? "週の確認のコメント" : "月の振り返り"}
      />
      {withImprovements ? (
        <>
          <span className="field-label">繰り返している問題</span>
          <textarea aria-label="繰り返している問題" className="field" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          <span className="field-label">改善事項（担当者・期限）</span>
          {imps.map((x, i) => (
            <div key={i} className="hc-imp">
              <input className="field" value={x.task} placeholder="改善すること" onChange={(e) => setImps(imps.map((y, j) => (j === i ? { ...y, task: e.target.value } : y)))} />
              <input className="field" value={x.owner} placeholder="担当者" onChange={(e) => setImps(imps.map((y, j) => (j === i ? { ...y, owner: e.target.value } : y)))} />
              <input className="field" type="date" value={x.due} onChange={(e) => setImps(imps.map((y, j) => (j === i ? { ...y, due: e.target.value } : y)))} aria-label="期限" />
              <label className="hc-toggle"><input type="checkbox" checked={x.done} onChange={(e) => setImps(imps.map((y, j) => (j === i ? { ...y, done: e.target.checked } : y)))} />済</label>
            </div>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => setImps([...imps, { task: "", owner: "", due: "", done: false }])}>＋ 改善事項</button>
          <label className="hc-toggle">
            <input type="checkbox" checked={planReview} onChange={(e) => setPlanReview(e.target.checked)} />
            計画の見直しが必要（メニュー・設備の変更、手順が合っていない など）
          </label>
        </>
      ) : null}
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() =>
          startT(async () => {
            setErr(null);
            const r = await saveReview({ kind, periodStart: start, periodEnd: end, comment, repeatIssues: repeat, improvements: imps, planReviewNeeded: planReview });
            if (!r.ok) setErr(r.error);
            else {
              setOk(true);
              router.refresh();
            }
          })
        }
      >
        {review ? "更新する" : kind === "week" ? "この週の記録を確認した" : "振り返りを保存"}
      </button>
      {ok ? <p className="micro">保存しました（確認した時点の集計も一緒に残ります）。</p> : null}
      {err ? <p className="err">{err}</p> : null}
    </div>
  );
}
