"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelStarRequest, requestStarExchange } from "@/app/(app)/settings/eval/actions";
import { STARS_PER_EXCHANGE } from "@/lib/store-eval";

/**
 * 自分の⭐（累計）。売上目標を達成した日に出勤していた回数（店主指定 2026-11-09「各アカウントの売上から自分の星の数」）。
 * 交換の申請は、オーナーが「交換を始める」にしてから出す（何と交換するかは、まだアプリに書かない）。
 */
export default function MyStars(p: { earned: number; available: number; enabled: boolean; openRequestId: string | null }) {
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
    <section className="card mystars" aria-label="あなたの⭐">
      <div className="eval-card__head">
        <span className="cost-sum__label">あなたの⭐（累計）</span>
        <span className="mystars__num">⭐ {p.earned}</span>
      </div>
      <p className="micro">売上目標を達成した日に出勤していた回数です（シフトを確定した8月から）。</p>
      {p.enabled ? (
        <>
          <p className="micro">
            使える⭐ <strong>{p.available}</strong>
            {p.openRequestId ? "（交換を申請中・店長が交換すると⭐" + STARS_PER_EXCHANGE + "が減ります）" : ""}
          </p>
          {p.openRequestId ? (
            <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={() => run(() => cancelStarRequest(p.openRequestId!))}>
              申請を取り下げる
            </button>
          ) : p.available >= STARS_PER_EXCHANGE ? (
            <button type="button" className="btn btn-primary btn-block" disabled={pending} onClick={() => run(requestStarExchange)}>
              ⭐{STARS_PER_EXCHANGE}で交換を申請する
            </button>
          ) : (
            <p className="micro">⭐{STARS_PER_EXCHANGE}個で交換を申請できます（あと{STARS_PER_EXCHANGE - p.available}個）。</p>
          )}
        </>
      ) : null}
      {err ? <p className="err">{err}</p> : null}
    </section>
  );
}
