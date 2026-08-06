"use client";

import { useEffect, useState } from "react";
import AnimatedYen from "@/components/AnimatedYen";
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
 *   1.6s〜 液面が目標の高さまで上がる
 *   4.4s  瓶が立って戻る。以降は液面がごく緩やかに揺れるだけ
 *
 * 氷は最初から入っている。注いでから現れるのは順序が逆になる。
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

/*
 * 画像を差し替えたことを端末に伝えるための版番号。
 * 同じファイル名のまま中身だけ替えると、ホーム画面アプリが古い絵を掴んだままになる。
 * 絵を描き直したらここを上げる。
 */
const V = "4";

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

  /*
   * 筋はグラスの底まで伸ばしておく。液体は筋より後に描かれるので、
   * 液面が上がるにつれて筋の下の方から順に隠れていく＝液に突き刺さって見える。
   *
   * 「満ちたときの液面」で筋を止めると、上昇中はまだ液面がそこまで来ておらず、
   * 筋の先と液面のあいだに隙間が空く。
   */
  const POUR_TOP = 3;
  const pourH = CAVITY.bottom * 100 - POUR_TOP;

  return (
    <section className={`whisky${reached ? " is-reached" : ""}`} aria-label="今月の積立">
      <div className="whisky__stage">
        {/* 瓶。注ぎ終わったら枠の外へ戻る */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/images/bottle.webp?v=${V}`} alt="" className="whisky__bottle" aria-hidden />

        {/* 注がれる筋。注ぎ口から液面まで届かせる。 */}
        <span
          className="whisky__pour"
          style={{ top: `${POUR_TOP}%`, height: `${pourH}%` }}
          aria-hidden
        >
          {/* 揺れは内側に持たせる。外側は伸びる演出（scaleY）で transform を使い切っている。 */}
          <span className="whisky__pourInner" />
        </span>

        <div className="whisky__glass">
          {/* グラス本体。液体はこの上に半透明で重ねる。 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/images/glass.webp?v=${V}`} alt="" className="whisky__photo" aria-hidden />

          {/*
           * 液体。グラス写真の「後ろ」に置くと、厚いカット面の底に隠れて
           * 溜まっているのが見えない。前面に半透明で重ね、カットガラスが
           * 琥珀越しに透けるようにする。実際のウイスキーもそう見える。
           */}
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
            {/*
             * 氷は最初からグラスに入っている。液体より下に置くので、
             * 液面より下に沈んだ部分だけが琥珀に染まり、
             * 上に出ている部分は透明なまま残る。
             */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/images/ice.webp?v=${V}`} alt="" className="whisky__ice" aria-hidden />
            <div className="whisky__liquid" style={{ height: `${fill * 100}%` }}>
              <span className="whisky__surface" aria-hidden />
              {/*
               * 着水の波紋。液体の上端に置いてあるので、液面が上がれば一緒に上がる。
               * 筋の先端に置くと、まだ空のうちから空中で波紋が広がってしまう。
               */}
              <span className="whisky__ripple" aria-hidden />
            </div>
          </div>
        </div>
      </div>

      <div className="whisky__figures">
        <p className="label">今月の運営積立金</p>
        <p className="whisky__amount">
          {/* 液面と同じ時間割で 0 から育つ。注ぎ終わりと同時に着地する。 */}
          <AnimatedYen to={saved} />
        </p>
        <p className="whisky__target micro">
          目標 {yen(target)} · {Math.round(ratio * 100)}%
        </p>
      </div>
    </section>
  );
}
