"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 見えた瞬間に is-in を付ける器。
 *
 * 台帳のグラフは画面の下の方にある。マウントと同時に動かすと、
 * スクロールして辿り着いたときにはもう終わっていて、誰も見ていない
 * アニメーションになる。動きは視界に入ってから始める。
 *
 * JS が来ない環境では is-in が付かないだけで、中身は静止画のまま全部見える。
 */
export default function Reveal({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      // 3割見えたら「見た」。端が掠っただけで始めると、肝心の動きが画面の外で終わる
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`${className ?? ""}${seen ? " is-in" : ""}`}>
      {children}
    </div>
  );
}
