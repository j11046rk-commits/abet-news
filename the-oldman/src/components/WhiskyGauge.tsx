"use client";

import { useEffect, useState } from "react";
import { yen } from "@/lib/money";

/**
 * 積立ゲージ — この画面の主役（DESIGN.md §5）。
 *
 * ロックグラスに、瓶からウイスキーが注がれて満ちていく。
 * 目盛りではなく「どれだけ入っているか」を液面の高さで見せる。
 *
 * 時間の流れ：
 *   0.0s  瓶が右上から傾いて入る
 *   0.7s  注ぎ口から一本の筋が落ちる
 *   0.7s〜 液面が目標の高さまで上がる
 *   2.6s  瓶が戻る。以降は液面がごく緩やかに揺れるだけ
 *
 * prefers-reduced-motion では瓶も筋も出さず、静止した液面だけを描く。
 */

// グラス内側の座標。ロックグラスなので背は低く、幅を持たせる。
const CAVITY_TOP = 116;
const CAVITY_BOTTOM = 224;
const CAVITY_H = CAVITY_BOTTOM - CAVITY_TOP;

export default function WhiskyGauge({ saved, target }: { saved: number; target: number }) {
  const ratio = target > 0 ? Math.max(0, Math.min(1, saved / target)) : 0;
  const reached = saved >= target;

  // 空の状態から注がれる。マウント後に目標の高さへ。
  const [fill, setFill] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setFill(ratio));
    return () => cancelAnimationFrame(id);
  }, [ratio]);

  // 液体は満杯の矩形を下へずらして見せる
  const drop = (1 - fill) * CAVITY_H;

  return (
    <section className={`whisky${reached ? " is-reached" : ""}`} aria-label="今月の積立">
      {/* viewBox はグラスに寄せて切る。瓶は枠外から入ってくる（overflow: visible）。 */}
      <svg className="whisky__svg" viewBox="46 86 148 152" role="img" aria-hidden>
        <defs>
          {/* グラスの内側だけを塗る */}
          <clipPath id="wg-cavity">
            <path d="M66,116 L174,116 L166,216 Q166,224 158,224 L82,224 Q74,224 74,216 Z" />
          </clipPath>

          <linearGradient id="wg-liquid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c9a05e" />
            <stop offset="55%" stopColor="#b08d4f" />
            <stop offset="100%" stopColor="#7d5f2b" />
          </linearGradient>

          {/* 厚いガラスの縁の照り */}
          <linearGradient id="wg-glass" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#e8e1d3" stopOpacity="0.22" />
            <stop offset="18%" stopColor="#e8e1d3" stopOpacity="0.05" />
            <stop offset="82%" stopColor="#e8e1d3" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#e8e1d3" stopOpacity="0.18" />
          </linearGradient>

          <linearGradient id="wg-bottle" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#241a12" />
            <stop offset="45%" stopColor="#3b2a19" />
            <stop offset="100%" stopColor="#1b120c" />
          </linearGradient>
        </defs>

        {/* ── 瓶（注ぎ終わったら戻る）───────────────────────────── */}
        <g className="whisky__bottle">
          <path d="M142,10 L162,10 L162,34 L172,48 L172,96 Q172,102 166,102 L138,102 Q132,102 132,96 L132,48 L142,34 Z"
                fill="url(#wg-bottle)" stroke="rgb(176 141 79 / .45)" strokeWidth="1" />
          <rect x="134" y="62" width="36" height="26" fill="#0c0d0f" opacity="0.55" />
          <rect x="142" y="6" width="20" height="6" fill="#5a2028" />
        </g>

        {/* ── 注がれる筋 ───────────────────────────────────────── */}
        <path className="whisky__pour" d="M148,104 C142,132 132,152 126,186"
              stroke="url(#wg-liquid)" strokeWidth="3.5" fill="none" strokeLinecap="round" />

        {/* ── グラス本体 ───────────────────────────────────────── */}
        <g clipPath="url(#wg-cavity)">
          {/* 液体：満杯の矩形を下へずらして液面を作る */}
          <g className="whisky__liquid" style={{ transform: `translateY(${drop}px)` }}>
            <rect x="60" y={CAVITY_TOP + 6} width="128" height={CAVITY_H} fill="url(#wg-liquid)" />
            {/* 液面 — 2波長ぶん描いて横に流す */}
            <svg
              className="whisky__wave"
              x="54"
              y={CAVITY_TOP - 2}
              width="240"
              height="12"
              viewBox="0 0 200 12"
              preserveAspectRatio="none"
            >
              <path d="M0,6 C12.5,2 37.5,2 50,6 C62.5,10 87.5,10 100,6 C112.5,2 137.5,2 150,6 C162.5,10 187.5,10 200,6 L200,12 L0,12 Z"
                    fill="#c9a05e" />
            </svg>
          </g>

          {/* 氷 — 液体の上に浮かせる */}
          <g className="whisky__ice">
            <rect x="86" y="150" width="42" height="38" rx="4" transform="rotate(-9 107 169)"
                  fill="#e8e1d3" opacity="0.16" stroke="#e8e1d3" strokeOpacity="0.3" />
            <rect x="120" y="172" width="36" height="34" rx="4" transform="rotate(14 138 189)"
                  fill="#e8e1d3" opacity="0.13" stroke="#e8e1d3" strokeOpacity="0.24" />
          </g>
        </g>

        {/* グラスの輪郭。厚みのある底を最後に重ねる */}
        <path d="M66,116 L174,116 L166,216 Q166,224 158,224 L82,224 Q74,224 74,216 Z"
              fill="url(#wg-glass)" stroke="rgb(176 141 79 / .55)" strokeWidth="1.5" />
        {/* ロックグラスの厚い底 */}
        <path d="M76,198 L164,198 L166,216 Q166,224 158,224 L82,224 Q74,224 74,216 Z"
              fill="#e8e1d3" opacity="0.09" />
        <ellipse cx="120" cy="116" rx="54" ry="6" fill="none"
                 stroke="rgb(176 141 79 / .8)" strokeWidth="2" />
      </svg>

      <div className="whisky__figures">
        <p className="label">今月の積立</p>
        <p className="whisky__amount">{yen(saved)}</p>
        <p className="whisky__target micro">
          目標 {yen(target)} · {Math.round(ratio * 100)}%
        </p>
      </div>
    </section>
  );
}
