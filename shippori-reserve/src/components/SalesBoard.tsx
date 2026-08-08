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

/** 数字がするすると増えるカウントアップ（みんなで見て楽しい・店主要望のアニメーション） */
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
 * 売上ボード。上に月の合計（目標・実績・達成率）、下に日毎の棒グラフ。
 * 棒は下からにゅっと伸びる（CSSアニメーション）。実績が目標に届いた日は金色。
 */
export default function SalesBoard({ days }: { days: SalesBoardDay[] }) {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const totals = useMemo(() => {
    let target = 0;
    let actual = 0;
    let hitDays = 0;
    let judgedDays = 0;
    for (const d of days) {
      if (d.target) target += d.target;
      if (d.actual) actual += d.actual;
      if (d.target && d.actual !== null) {
        judgedDays += 1;
        if (d.actual >= d.target) hitDays += 1;
      }
    }
    return { target, actual, hitDays, judgedDays };
  }, [days]);

  const shownActual = useCountUp(totals.actual);
  const shownTarget = useCountUp(totals.target);
  const rate = totals.target > 0 ? Math.round((totals.actual / totals.target) * 100) : null;
  const shownRate = useCountUp(rate ?? 0);

  const max = useMemo(
    () => Math.max(1, ...days.map((d) => Math.max(d.target ?? 0, d.actual ?? 0))),
    [days],
  );

  const hasData = days.some((d) => d.target || d.actual !== null);

  if (!hasData) {
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <p className="micro" style={{ margin: 0 }}>
          この月の目標・実績はまだ入っていません。
          <br />
          目標は カレンダー → 日付 → <Link href="/">営業日の設定</Link> から入れられます。
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      {/* 月の合計 */}
      <section className="summary">
        <div className="summary__item">
          <span className="summary__num salesnum">{fmtYen(shownActual)}</span>
          <span className="summary__label">実績</span>
        </div>
        <div className="summary__item">
          <span className="summary__num">{fmtYen(shownTarget)}</span>
          <span className="summary__label">目標</span>
        </div>
        <div className="summary__item">
          <span className={`summary__num ${rate !== null && rate >= 100 ? "salesnum--hit" : ""}`}>
            {rate === null ? "—" : `${shownRate}%`}
          </span>
          <span className="summary__label">
            達成率{totals.judgedDays > 0 ? `・${totals.hitDays}/${totals.judgedDays}日達成` : ""}
          </span>
        </div>
      </section>

      {/* 日毎の棒グラフ。タップでその日の詳細へ。 */}
      <section className="card">
        <div className={`saleschart ${grown ? "saleschart--grown" : ""}`} role="img" aria-label="日毎の売上グラフ">
          {days.map((d, i) => {
            const t = d.target ?? 0;
            const a = d.actual ?? 0;
            const hit = t > 0 && a >= t;
            return (
              <Link
                key={d.date}
                href={`/day/${d.date}`}
                className={`salescol ${d.isToday ? "salescol--today" : ""}`}
                aria-label={`${d.day}日 目標${t ? fmtMan(t) : "なし"} 実績${d.actual !== null ? fmtMan(a) : "なし"}`}
              >
                <span className="salescol__bars">
                  {t > 0 ? (
                    <span
                      className="salesbar salesbar--target"
                      style={{ height: `${(t / max) * 100}%`, transitionDelay: `${i * 18}ms` }}
                    />
                  ) : null}
                  {d.actual !== null ? (
                    <span
                      className={`salesbar salesbar--actual ${hit ? "salesbar--hit" : ""}`}
                      style={{ height: `${(a / max) * 100}%`, transitionDelay: `${i * 18 + 90}ms` }}
                    />
                  ) : null}
                </span>
                <span
                  className={`salescol__day ${d.dow === 0 || d.holiday ? "dow-red" : d.dow === 6 ? "dow-blue" : ""}`}
                >
                  {/* 31本並ぶので日付は5日刻みと今日だけ書く（詰まって読めなくなる） */}
                  {d.day === 1 || d.day % 5 === 0 || d.isToday ? d.day : ""}
                </span>
              </Link>
            );
          })}
        </div>
        <p className="micro" style={{ margin: "0.5rem 0 0", textAlign: "center" }}>
          <span className="saleslegend saleslegend--target" /> 目標
          <span style={{ display: "inline-block", width: "1rem" }} />
          <span className="saleslegend saleslegend--actual" /> 実績
          <span style={{ display: "inline-block", width: "1rem" }} />
          <span className="saleslegend saleslegend--hit" /> 達成
        </p>
      </section>

      {/* 日毎の数字（データのある日だけ） */}
      <section className="card">
        <ul className="saleslist">
          {days
            .filter((d) => d.target || d.actual !== null)
            .map((d) => {
              const hit = d.target && d.actual !== null && d.actual >= d.target;
              return (
                <li key={d.date} className="saleslist__row">
                  <Link href={`/day/${d.date}`} className="saleslist__date">
                    {d.day}
                    <span
                      className={`mrow__dow ${d.dow === 0 || d.holiday ? "mrow__dow--sun" : d.dow === 6 ? "mrow__dow--sat" : ""}`}
                      style={{ marginLeft: "0.25rem" }}
                    >
                      {d.dowLabel}
                    </span>
                  </Link>
                  <span className="saleslist__nums">
                    <span className={hit ? "salesnum--hit" : undefined}>
                      {d.actual !== null ? fmtYen(d.actual) : "—"}
                    </span>
                    <span className="muted"> / {d.target ? fmtYen(d.target) : "目標なし"}</span>
                    {hit ? " 🎯" : ""}
                  </span>
                </li>
              );
            })}
        </ul>
      </section>
    </div>
  );
}
