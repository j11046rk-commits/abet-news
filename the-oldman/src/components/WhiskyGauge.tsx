"use client";

import { useEffect, useState } from "react";
import { yen } from "@/lib/money";

/**
 * 積立ゲージ — この画面の主役（DESIGN.md §5）。
 *
 * ロックグラスに、瓶からウイスキーが注がれて満ちていく。
 * 目盛りではなく「どれだけ入っているか」を液面の高さで見せる。
 *
 * 手描きのSVGでは厚いガラスの質感が出なかったので、写真から抜いた3枚を重ねている。
 * 重ね順は下から：液体 → 氷 → グラス。グラスの写真は空洞が透けているので、
 * 液面はその内側にそのまま見える。ガラス越しの歪みと照りは写真の側が持っている。
 *
 * 時間の流れ：
 *   0.0s  瓶が右上から傾いて入る
 *   0.7s  注ぎ口から一本の筋が落ちる
 *   0.7s〜 液面が目標の高さまで上がる
 *   2.6s  瓶が戻る。以降は液面がごく緩やかに揺れるだけ
 *
 * prefers-reduced-motion では瓶も筋も出さず、静止した液面だけを描く。
 */

/**
 * glass.webp の中でのグラス内側の位置（画像の幅・高さに対する割合）。
 * 数字は書き出した画像に候補の枠を重ねて実測したもの。
 *
 * タンブラーは下すぼまりなので、矩形ではなく台形で切る。矩形だと液面が
 * 下がったときにガラスの壁の外へはみ出す。
 */
const CAVITY = { left: 0.10, right: 0.84, top: 0.055, bottom: 0.83 };
/** 台形の下辺（CAVITY の枠に対する割合）。 */
const TAPER = { left: 0.095, right: 0.92 };

export default function WhiskyGauge({ saved, target }: { saved: number; target: number }) {
  const ratio = target > 0 ? Math.max(0, Math.min(1, saved / target)) : 0;
  const reached = saved >= target;

  // 空の状態から注がれる。マウント後に目標の高さへ。
  const [fill, setFill] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setFill(ratio));
    return () => cancelAnimationFrame(id);
  }, [ratio]);

  const cavityH = CAVITY.bottom - CAVITY.top;
  const clip = `polygon(0% 0%, 100% 0%, ${TAPER.right * 100}% 100%, ${TAPER.left * 100}% 100%)`;

  return (
    <section className={`whisky${reached ? " is-reached" : ""}`} aria-label="今月の積立">
      <div className="whisky__stage">
        {/* 瓶。注ぎ終わったら枠の外へ戻る */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/bottle.webp" alt="" className="whisky__bottle" aria-hidden />

        {/* 注がれる筋 */}
        <span className="whisky__pour" aria-hidden />

        <div className="whisky__glass">
          {/* 液体。グラスの空洞の中だけを、下から満たしていく */}
          <div
            className="whisky__cavity"
            style={{
              left: `${CAVITY.left * 100}%`,
              right: `${(1 - CAVITY.right) * 100}%`,
              top: `${CAVITY.top * 100}%`,
              height: `${cavityH * 100}%`,
              clipPath: clip,
            }}
          >
            <div className="whisky__liquid" style={{ height: `${fill * 100}%` }}>
              <span className="whisky__surface" aria-hidden />
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/ice.webp" alt="" className="whisky__ice" aria-hidden />
          </div>

          {/* グラス本体。空洞が透けているので最後に重ねる */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/glass.webp" alt="" className="whisky__photo" aria-hidden />
        </div>
      </div>

      <div className="whisky__figures">
        <p className="label">今月の運営収入</p>
        <p className="whisky__amount">{yen(saved)}</p>
        <p className="whisky__target micro">
          目標 {yen(target)} · {Math.round(ratio * 100)}%
        </p>
      </div>
    </section>
  );
}
