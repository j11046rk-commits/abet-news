"use client";

import { useEffect, useRef, useState } from "react";
import { yen } from "@/lib/money";

/*
 * 液面の上昇と同じ時間割（globals.css の .whisky__liquid と揃えてある）。
 * 数字だけ先に着地すると、注ぎ終わっていないのに金額が確定して見える。
 */
const RISE_MS = 2100;
const RISE_DELAY_MS = 1560;

/** cubic-bezier(0.22, 0.68, 0.3, 1) — 液面と同じ緩急。 */
function ease(x: number): number {
  const ax = 3 * 0.22 - 3 * 0.3 + 1;
  const bx = 3 * 0.3 - 6 * 0.22;
  const cx = 3 * 0.22;
  const ay = 3 * 0.68 - 3 * 1 + 1;
  const by = 3 * 1 - 6 * 0.68;
  const cy = 3 * 0.68;
  // x に対応する媒介変数 t をニュートン法で求め、その t の y を返す
  let t = x;
  for (let i = 0; i < 6; i += 1) {
    const fx = ((ax * t + bx) * t + cx) * t - x;
    const dfx = (3 * ax * t + 2 * bx) * t + cx;
    if (Math.abs(dfx) < 1e-6) break;
    t -= fx / dfx;
  }
  t = Math.max(0, Math.min(1, t));
  return ((ay * t + by) * t + cy) * t;
}

/**
 * 金額のカウンター。開いたとき from から to まで、液面と同じ呼吸で動く。
 *
 * サーバーは最終値を描く（JS が来る前・動きを切っている人にはそれが正しい表示）。
 * マウント後にだけ巻き戻して動かす。
 * 表示中に値が変わったら（レーキを記録して更新した等）、いまの表示から
 * 新しい値へ短く動く — 毎回ゼロからやり直すと芝居がかる。
 */
export default function AnimatedYen({
  to,
  from = 0,
  duration = RISE_MS,
  delay = RISE_DELAY_MS,
}: {
  to: number;
  from?: number;
  duration?: number;
  delay?: number;
}) {
  const [shown, setShown] = useState(to);
  const shownRef = useRef(to);
  const first = useRef(true);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shownRef.current = to;
      setShown(to);
      return;
    }

    const start = first.current ? from : shownRef.current;
    const dur = first.current ? duration : 600;
    const wait = first.current ? delay : 0;
    first.current = false;
    if (start === to) return;

    let raf = 0;
    let t0: number | null = null;
    const tick = (now: number) => {
      if (t0 === null) t0 = now;
      const elapsed = now - t0 - wait;
      if (elapsed < 0) {
        shownRef.current = start;
        setShown(start);
        raf = requestAnimationFrame(tick);
        return;
      }
      const p = Math.min(1, elapsed / dur);
      const v = Math.round(start + (to - start) * ease(p));
      shownRef.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, from, duration, delay]);

  return <>{yen(shown)}</>;
}
