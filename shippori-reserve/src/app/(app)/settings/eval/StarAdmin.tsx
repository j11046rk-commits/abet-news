"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelStarRequest, markStarExchanged, setStarExchange } from "./actions";

type Person = { id: string; name: string; earned: number; used: number; requested: number; available: number };
type Req = { id: string; profileId: string; name: string; stars: number; requestedAt: string };

const md = (iso: string) => new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });

/** 達成貢献⭐：全員の累計と、交換の申請（店長が渡したら「交換しました」）。交換を始めるかはオーナーが決める */
export default function StarAdmin(p: { isOwner: boolean; enabled: boolean; people: Person[]; requests: Req[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setErr(null);
      const r = await fn();
      if (!r.ok) setErr(r.error ?? "できませんでした。");
      else router.refresh();
    });
  return (
    <section className="card stack" aria-label="達成貢献⭐">
      <h2 className="section-title">達成貢献⭐</h2>
      {p.requests.length > 0 ? (
        <ul className="cost-list" aria-label="交換の申請">
          {p.requests.map((r) => (
            <li key={r.id} className="cost-row">
              <div className="cost-row__main">
                <span className="cost-row__vendor">
                  {r.name}
                  <span className="micro">　{md(r.requestedAt)}に申請</span>
                </span>
                <span className="cost-row__amt">⭐{r.stars}</span>
              </div>
              <div className="row" style={{ gap: "1rem" }}>
                <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => run(() => markStarExchanged(r.id))}>
                  交換しました
                </button>
                <button type="button" className="linklike" disabled={pending} onClick={() => run(() => cancelStarRequest(r.id))}>
                  取り下げ
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <table className="eval-table">
        <thead>
          <tr>
            <th>名前</th>
            <th>累計</th>
            <th>交換済み</th>
            <th>使える</th>
          </tr>
        </thead>
        <tbody>
          {p.people.map((x) => (
            <tr key={x.id}>
              <td>{x.name}</td>
              <td>{x.earned}</td>
              <td>{x.used}</td>
              <td>
                {x.available}
                {x.requested ? "（申請中）" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="micro">累計＝シフトを確定した月（8月〜）で、売上目標を達成した日に出勤していた回数。本人は売上タブで自分の分を見られます。</p>
      {p.isOwner ? (
        <div className="stack">
          <p className="micro">
            交換：<strong>{p.enabled ? "受付中（スタッフの売上タブに申請ボタンが出ています）" : "まだ始めていません（申請ボタンは出ていません）"}</strong>
          </p>
          <button
            type="button"
            className={`btn btn-sm${p.enabled ? " btn-ghost" : ""}`}
            disabled={pending}
            onClick={() => {
              if (!window.confirm(p.enabled ? "交換の受付を止めますか？" : "交換の受付を始めますか？（スタッフの売上タブに申請ボタンが出ます）")) return;
              run(() => setStarExchange(!p.enabled));
            }}
          >
            {p.enabled ? "交換の受付を止める" : "交換の受付を始める"}
          </button>
        </div>
      ) : (
        <p className="micro">交換の受付：{p.enabled ? "受付中" : "まだ始めていません"}</p>
      )}
      {err ? <p className="err">{err}</p> : null}
    </section>
  );
}
