"use client";

import { useEffect, useState } from "react";
import { yen } from "@/lib/money";

/**
 * 積立ゲージ — この画面の主役。ここにだけ大胆さを使う（DESIGN.md §5）。
 *
 * グラスに琥珀色の液体が満ちていくように、月次目標に対する積立額を縦型で表す。
 * 液面は SVG の正弦波を CSS アニメーションで横に流す（rAF を毎フレーム回さない）。
 * prefers-reduced-motion では波を止め、静止した液面にする。
 */
export default function VaultGauge({
  saved,
  target,
}: {
  saved: number;
  target: number;
}) {
  const ratio = target > 0 ? Math.max(0, Math.min(1, saved / target)) : 0;
  const reached = saved >= target;

  // 初期表示は空。マウント後に満ちる（900ms）。
  const [fill, setFill] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setFill(ratio));
    return () => cancelAnimationFrame(id);
  }, [ratio]);

  return (
    <section className="vault" aria-label="今月の積立">
      <div className={`vault__glass${reached ? " is-reached" : ""}`}>
        <div className="vault__liquid" style={{ height: `${fill * 100}%` }}>
          {/* 液面 — 2波長ぶん描いて横に流す。振幅 2.5px / 周期 4.2s */}
          <svg
            className="vault__wave"
            viewBox="0 0 200 12"
            preserveAspectRatio="none"
            aria-hidden
          >
            <path d="M0,6 C12.5,1 37.5,1 50,6 C62.5,11 87.5,11 100,6 C112.5,1 137.5,1 150,6 C162.5,11 187.5,11 200,6 L200,12 L0,12 Z" />
          </svg>
          <svg
            className="vault__wave vault__wave--back"
            viewBox="0 0 200 12"
            preserveAspectRatio="none"
            aria-hidden
          >
            <path d="M0,6 C12.5,1 37.5,1 50,6 C62.5,11 87.5,11 100,6 C112.5,1 137.5,1 150,6 C162.5,11 187.5,11 200,6 L200,12 L0,12 Z" />
          </svg>
        </div>

        {/* 目盛は 25% 刻み。数字は振らない。 */}
        <span className="vault__ticks" aria-hidden>
          <i style={{ bottom: "25%" }} />
          <i style={{ bottom: "50%" }} />
          <i style={{ bottom: "75%" }} />
        </span>
      </div>

      <div className="vault__figures">
        <p className="label">今月の積立</p>
        <p className="vault__amount">{yen(saved)}</p>
        <p className="vault__target micro">
          目標 {yen(target)} · {Math.round(ratio * 100)}%
        </p>
      </div>
    </section>
  );
}
