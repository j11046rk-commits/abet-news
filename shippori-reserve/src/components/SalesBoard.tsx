"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { fmtYen } from "@/lib/sales";

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

/** 達成率。小数点第2位を四捨五入して第1位まで（店主指定） */
const rate1 = (actual: number, target: number): number => Math.round((actual / target) * 1000) / 10;

/**
 * 売上ボード（グリッドのカレンダー）。金額はすべて1円単位で出す（店主指定）。
 * 月間目標は日毎の合計ではなく、店主が決めた端数なしの数字（sales_monthly）が正。
 * 達成率・「あと◯円」もその数字がベース。
 */
export default function SalesBoard({
  days,
  today,
  monthlyTarget,
}: {
  days: SalesBoardDay[];
  today: string;
  monthlyTarget: number | null;
}) {
  const { dailySum, cumTarget, cumLabel, actualTotal } = useMemo(() => {
    let dailySum = 0;
    let cumTarget = 0;
    let actualTotal = 0;
    for (const d of days) {
      if (d.target) {
        dailySum += d.target;
        if (d.date <= today) cumTarget += d.target;
      }
      if (d.actual) actualTotal += d.actual;
    }
    const inMonth = days.some((d) => d.isToday);
    const cumLabel = inMonth
      ? `${Number(today.slice(5, 7))}/${Number(today.slice(8))}までの目標`
      : "現時点の目標";
    return { dailySum, cumTarget, cumLabel, actualTotal };
  }, [days, today]);

  // 月間目標：端数なしの正の数字。無い月だけ日毎の合計で代用する。
  const monthTarget = monthlyTarget ?? dailySum;
  const remaining = monthTarget > 0 ? monthTarget - actualTotal : null;
  const monthRate = monthTarget > 0 ? rate1(actualTotal, monthTarget) : null;
  const cumRate = cumTarget > 0 ? rate1(actualTotal, cumTarget) : null;
  const onPace = cumRate !== null && cumRate >= 100;

  const shownMonth = useCountUp(monthTarget);
  const shownCum = useCountUp(cumTarget);
  const shownActual = useCountUp(actualTotal);
  const shownRemaining = useCountUp(Math.abs(remaining ?? 0));
  // 小数1桁の率は「10倍の整数」で数えて 1/10 にして出す
  const shownMonthRate = useCountUp(Math.round((monthRate ?? 0) * 10));
  const shownCumRate = useCountUp(Math.round((cumRate ?? 0) * 10));

  const lead = days.length > 0 ? days[0].dow : 0;

  return (
    <div className="stack">
      {/* 月間目標といまの到達点。いちばん上に大きく（店主指定）。 */}
      <section className="card">
        <div className="salesgoal">
          <span className="summary__label">月間売上目標</span>
          <span className="salesgoal__num">{monthTarget > 0 ? fmtYen(shownMonth) : "—"}</span>
        </div>
        {remaining !== null ? (
          <p className="salesgoal__meta">
            {monthRate !== null ? (
              <span className={monthRate >= 100 ? "salesnum--hit" : undefined}>
                達成率 {(shownMonthRate / 10).toFixed(1)}%
              </span>
            ) : null}
            {remaining > 0 ? (
              <span>
                達成まで あと <strong>{fmtYen(shownRemaining)}</strong>
              </span>
            ) : (
              <span className="salesnum--hit">目標達成🎯 ＋{fmtYen(shownRemaining)}</span>
            )}
          </p>
        ) : null}
      </section>

      {/* 現時点（月初〜今日の日毎目標の累計）に対する実績 */}
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
            {cumRate === null ? "—" : `${(shownCumRate / 10).toFixed(1)}%`}
          </span>
          <span className="summary__label">現時点の達成率</span>
        </div>
      </section>

      {/* 月のグリッド。各日に目標と実績（1円単位）。 */}
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
              aria-label={`${d.day}日 目標${d.target ? fmtYen(d.target) : "なし"} 実績${d.actual != null ? fmtYen(d.actual) : "なし"}`}
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
                    {d.actual != null ? `${d.actual.toLocaleString()}${hit ? "🎯" : ""}` : "ー"}
                  </span>
                  <span className="salescell__t">{d.target ? d.target.toLocaleString() : ""}</span>
                </>
              )}
            </Link>
          );
        })}
      </div>

      <p className="micro" style={{ textAlign: "center", margin: 0 }}>
        上段＝実績（<span className="salesnum--hit">金色🎯＝目標達成</span>）・下段＝目標（円）。タップでその日の詳細へ。
      </p>
    </div>
  );
}
