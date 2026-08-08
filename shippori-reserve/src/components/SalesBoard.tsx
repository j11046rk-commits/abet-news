"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { fmtMan, fmtYen } from "@/lib/sales";

export type SalesBoardDay = {
  date: string;
  day: number;
  dow: number;
  dowLabel: string;
  holiday: boolean;
  closed: boolean;
  target: number | null;
  actual: number | null;
  isToday: boolean;
};

/** 数字がするすると増えるカウントアップ（店主要望のアニメーション） */
function useCountUp(value: number, ms = 900): number {
  const [shown, setShown] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) {
      setShown(value);
      return;
    }
    started.current = true;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(value * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

/**
 * 売上ボード（グリッドのカレンダー・店主指定でグラフなし）。
 * 上：月間目標／現時点の目標（月初〜今日の日毎目標の累計）／実績と達成率。
 * 下：月のグリッド。各日に目標と実績。タップでその日の詳細へ。
 */
export default function SalesBoard({ days, today }: { days: SalesBoardDay[]; today: string }) {
  const { monthTarget, cumTarget, cumLabel, actualTotal } = useMemo(() => {
    let monthTarget = 0;
    let cumTarget = 0;
    let actualTotal = 0;
    for (const d of days) {
      if (d.target) {
        monthTarget += d.target;
        if (d.date <= today) cumTarget += d.target;
      }
      if (d.actual) actualTotal += d.actual;
    }
    // 今日を含む月なら「8/8までの目標」、過去の月なら月間と同じ、未来の月は 0
    const inMonth = days.some((d) => d.isToday);
    const cumLabel = inMonth
      ? `${Number(today.slice(5, 7))}/${Number(today.slice(8))}までの目標`
      : "現時点の目標";
    return { monthTarget, cumTarget, cumLabel, actualTotal };
  }, [days, today]);

  const rate = cumTarget > 0 ? Math.round((actualTotal / cumTarget) * 100) : null;
  const onPace = rate !== null && rate >= 100;

  const shownMonth = useCountUp(monthTarget);
  const shownCum = useCountUp(cumTarget);
  const shownActual = useCountUp(actualTotal);
  const shownRate = useCountUp(rate ?? 0);

  const lead = days.length > 0 ? days[0].dow : 0;

  return (
    <div className="stack">
      {/* 月間目標。いちばん上に大きく（店主指定）。 */}
      <section className="card salesgoal">
        <span className="summary__label">月間売上目標</span>
        <span className="salesgoal__num">{monthTarget > 0 ? fmtYen(shownMonth) : "—"}</span>
      </section>

      {/* 現時点での目標に対する実績 */}
      <section className="summary">
        <div className="summary__item">
          <span className={`summary__num ${onPace ? "salesnum--hit" : ""}`}>
            {fmtYen(shownActual)}
          </span>
          <span className="summary__label">実績</span>
        </div>
        <div className="summary__item">
          <span className="summary__num">{cumTarget > 0 ? fmtYen(shownCum) : "—"}</span>
          <span className="summary__label">{cumLabel}</span>
        </div>
        <div className="summary__item">
          <span className={`summary__num ${onPace ? "salesnum--hit" : ""}`}>
            {rate === null ? "—" : `${shownRate}%`}
          </span>
          <span className="summary__label">現時点の達成率</span>
        </div>
      </section>

      {/* 月のグリッド。各日に目標と実績。 */}
      <div className="salesgrid" role="grid" aria-label="日毎の売上目標と実績">
        {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
          <div key={w} className="salesgrid__head">
            {w}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {days.map((d) => {
          const hit = d.target != null && d.actual != null && d.actual >= d.target;
          return (
            <Link
              key={d.date}
              href={`/day/${d.date}`}
              className={`salescell ${d.closed ? "salescell--closed" : ""} ${d.isToday ? "salescell--today" : ""}`}
              aria-label={`${d.day}日 目標${d.target ? fmtMan(d.target) : "なし"} 実績${d.actual != null ? fmtMan(d.actual) : "なし"}`}
            >
              <span
                className={`salescell__day ${d.dow === 0 || d.holiday ? "dow-red" : d.dow === 6 ? "dow-blue" : ""}`}
              >
                {d.day}
              </span>
              {d.closed ? (
                <span className="salescell__t">休</span>
              ) : (
                <>
                  <span className={`salescell__a ${hit ? "salescell__a--hit" : ""}`}>
                    {d.actual != null ? `${fmtMan(d.actual)}${hit ? "🎯" : ""}` : "ー"}
                  </span>
                  <span className="salescell__t">{d.target ? `目標${fmtMan(d.target)}` : ""}</span>
                </>
              )}
            </Link>
          );
        })}
      </div>

      <p className="micro" style={{ textAlign: "center", margin: 0 }}>
        上段＝実績（<span className="salesnum--hit">金色🎯＝目標達成</span>）・下段＝目標。タップでその日の詳細へ。
      </p>
    </div>
  );
}
