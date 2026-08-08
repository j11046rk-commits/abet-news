"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { fmtYen } from "@/lib/sales";
import { chipColors } from "@/lib/staff";

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

export type SalesContrib = {
  id: string;
  name: string;
  colorIndex: number;
  stars: number;
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

/** 紙吹雪。乱数を使わず添字から散らす（サーバー描画とズレないように） */
function Confetti() {
  const [alive, setAlive] = useState(false);
  useEffect(() => {
    setAlive(true);
    const t = setTimeout(() => setAlive(false), 3200);
    return () => clearTimeout(t);
  }, []);
  if (!alive) return null;
  const colors = ["var(--gold)", "var(--seal)", "#7ea6d9", "var(--gold-soft)", "#5aa87a"];
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: 36 }, (_, i) => (
        <span
          key={i}
          className="confetti__p"
          style={{
            left: `${(i * 37 + 11) % 100}%`,
            background: colors[i % colors.length],
            animationDelay: `${(i % 12) * 0.13}s`,
            width: `${6 + (i % 3) * 3}px`,
            height: `${9 + ((i * 7) % 4) * 3}px`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * 売上ボード。毎日目標を達成するのが楽しくなる仕組み（店主承認 A+B+C+D）：
 * A 達成した日の祝い（紙吹雪＋バナー・月間達成は特別版）
 * B 連続達成ストリーク🔥（今月の現在と最長）
 * C 達成した日に出勤していた人へ⭐（確定シフト×達成日）
 * D 月間目標への道のりゲージ（25/50/75の節目＋ペースからの月末着地予測）
 */
export default function SalesBoard({
  days,
  today,
  monthlyTarget,
  contrib,
  shiftsPublished,
}: {
  days: SalesBoardDay[];
  today: string;
  monthlyTarget: number | null;
  contrib: SalesContrib[];
  shiftsPublished: boolean;
}) {
  const { dailySum, cumTarget, cumLabel, actualTotal, inMonth } = useMemo(() => {
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
    return { dailySum, cumTarget, cumLabel, actualTotal, inMonth };
  }, [days, today]);

  // B: ストリーク。実績が入っている営業日だけを時系列で見る（休業日は数えない・途切れさせない）
  const { currentStreak, bestStreak, latest } = useMemo(() => {
    const judged = days.filter((d) => d.target != null && d.actual != null);
    let currentStreak = 0;
    for (let i = judged.length - 1; i >= 0; i--) {
      if (judged[i].actual! >= judged[i].target!) currentStreak++;
      else break;
    }
    let bestStreak = 0;
    let run = 0;
    for (const d of judged) {
      if (d.actual! >= d.target!) {
        run++;
        if (run > bestStreak) bestStreak = run;
      } else {
        run = 0;
      }
    }
    return { currentStreak, bestStreak, latest: judged[judged.length - 1] ?? null };
  }, [days]);

  const monthTarget = monthlyTarget ?? dailySum;
  const remaining = monthTarget > 0 ? monthTarget - actualTotal : null;
  const monthRate = monthTarget > 0 ? rate1(actualTotal, monthTarget) : null;
  const cumRate = cumTarget > 0 ? rate1(actualTotal, cumTarget) : null;
  const onPace = cumRate !== null && cumRate >= 100;

  // A: 祝うのは「最新の実績の日が達成」or「月間達成」
  const latestHit = latest !== null && latest.actual! >= latest.target!;
  const monthlyHit = monthTarget > 0 && actualTotal >= monthTarget;

  // D: ゲージと着地予測（いまのペース＝実績÷今日までの目標 を月間に引き伸ばす）
  const progress = monthTarget > 0 ? Math.min(100, (actualTotal / monthTarget) * 100) : 0;
  const forecast =
    inMonth && cumTarget > 0 && actualTotal > 0
      ? Math.round((monthTarget * actualTotal) / cumTarget)
      : null;
  const [gaugeGrown, setGaugeGrown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setGaugeGrown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const shownMonth = useCountUp(monthTarget);
  const shownCum = useCountUp(cumTarget);
  const shownActual = useCountUp(actualTotal);
  const shownRemaining = useCountUp(Math.abs(remaining ?? 0));
  const shownMonthRate = useCountUp(Math.round((monthRate ?? 0) * 10));
  const shownCumRate = useCountUp(Math.round((cumRate ?? 0) * 10));

  const lead = days.length > 0 ? days[0].dow : 0;
  const anyStars = contrib.some((c) => c.stars > 0);

  return (
    <div className="stack">
      {(latestHit || monthlyHit) && <Confetti />}

      {/* A: 達成のお祝い */}
      {monthlyHit ? (
        <section className="card cheer cheer--month">
          <span className="cheer__big">🏆 月間目標達成！！</span>
          <span>
            {fmtYen(monthTarget)} を超えました（＋{fmtYen(actualTotal - monthTarget)}）
          </span>
        </section>
      ) : latestHit && latest ? (
        <section className="card cheer">
          <span>
            🎉 {Number(latest.date.slice(5, 7))}/{Number(latest.date.slice(8))} 目標達成！{" "}
            <strong>{fmtYen(latest.actual!)}</strong>
            <span className="micro">（＋{fmtYen(latest.actual! - latest.target!)}）</span>
          </span>
          {currentStreak >= 2 ? (
            <span className="cheer__streak">🔥 {currentStreak}日連続達成中！</span>
          ) : null}
        </section>
      ) : currentStreak >= 2 ? (
        <section className="card cheer">
          <span className="cheer__streak">🔥 {currentStreak}日連続達成中！</span>
        </section>
      ) : null}

      {/* D: 月間目標と道のり */}
      <section className="card">
        <div className="salesgoal">
          <span className="summary__label">月間売上目標</span>
          <span className="salesgoal__num">{monthTarget > 0 ? fmtYen(shownMonth) : "—"}</span>
        </div>

        {monthTarget > 0 ? (
          <div className={`gauge ${gaugeGrown ? "gauge--grown" : ""}`} aria-hidden>
            <div className="gauge__bar">
              <div
                className={`gauge__fill ${monthlyHit ? "gauge__fill--full" : ""}`}
                style={{ width: `${progress}%` }}
              />
              {[25, 50, 75].map((m) => (
                <span
                  key={m}
                  className={`gauge__tick ${progress >= m ? "gauge__tick--on" : ""}`}
                  style={{ left: `${m}%` }}
                />
              ))}
            </div>
            <div className="gauge__marks">
              <span className={progress >= 25 ? "gauge__mark--on" : ""}>25%</span>
              <span className={progress >= 50 ? "gauge__mark--on" : ""}>50%</span>
              <span className={progress >= 75 ? "gauge__mark--on" : ""}>75%</span>
            </div>
          </div>
        ) : null}

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

        {forecast !== null && !monthlyHit ? (
          <p className="micro" style={{ margin: "0.3rem 0 0" }}>
            いまのペースなら月末 {fmtYen(forecast)}
            {forecast >= monthTarget ? "（達成ペース！🔥）" : ""}
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

      {/* C: 達成貢献⭐ */}
      <section className="card">
        <p className="micro" style={{ letterSpacing: "0.12em", margin: "0 0 0.5rem" }}>
          今月の達成貢献
        </p>
        {shiftsPublished ? (
          <>
            <div className="chips">
              {contrib.map((c) => (
                <span key={c.id} className="shiftchip" style={chipColors(c.colorIndex)}>
                  {c.name} {c.stars > 0 ? "⭐".repeat(Math.min(c.stars, 10)) : "—"}
                  {c.stars > 10 ? `×${c.stars}` : ""}
                </span>
              ))}
            </div>
            <p className="micro" style={{ margin: "0.4rem 0 0" }}>
              目標を達成した日に出勤していた人に⭐がつきます。
              {anyStars && bestStreak >= 2 ? `今月の最長連続達成は ${bestStreak} 日。` : ""}
            </p>
          </>
        ) : (
          <p className="micro" style={{ margin: 0 }}>
            シフトが確定すると、達成した日に出勤していた人に⭐がつきます。
          </p>
        )}
      </section>
    </div>
  );
}
