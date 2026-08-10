"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { fmtYen, hitOf, shownYen } from "@/lib/sales";
import { chipColors } from "@/lib/staff";

export type SalesBoardDay = {
  date: string;
  day: number;
  dow: number;
  dowLabel: string;
  holiday: boolean;
  closed: boolean;
  target: number | null;
  isToday: boolean;
  /** 店内の売上。日毎の表示と達成判定はこれだけを見る */
  dineIn: number | null;
  /** 物販の売上。0 なら物販なし */
  retail: number;
  /** その日の合計（店内＋物販）。月間に積むのはこれ */
  total: number | null;
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
 *
 * ★物差しが2つある（店主指示 2026-08「日毎からは外して、月間には計上する」）
 *   店内だけで見る … A の日次バナー・B ストリーク・C ⭐・グリッドの金色
 *   物販込みで見る … D のゲージ・月間目標の達成・実績タイル・残り・達成率
 *   物販そのもの   … 別枠の「今月の物販」カード
 * どれか1つだけ基準を動かすと、同じ日について画面ごとに答えが違う状態になる。
 * 日毎の判定は必ず lib/sales.ts の hitOf() を通すこと。
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
  const { dailySum, cumTarget, cumLabel, actualTotal, retailTotal, retailDays, inMonth } = useMemo(() => {
    let dailySum = 0;
    let cumTarget = 0;
    let actualTotal = 0;
    let retailTotal = 0;
    const retailDays: SalesBoardDay[] = [];
    for (const d of days) {
      if (d.target) {
        dailySum += d.target;
        if (d.date <= today) cumTarget += d.target;
      }
      // 月間は合計（物販込み）で積む。店内合計は下で引き算して出すので、
      // 画面に並ぶ「店内 ＋ 物販 ＝ 合計」は必ず合う。
      if (d.total != null) actualTotal += d.total;
      if (d.retail > 0) {
        retailTotal += d.retail;
        retailDays.push(d);
      }
    }
    const inMonth = days.some((d) => d.isToday);
    const cumLabel = inMonth
      ? `${Number(today.slice(5, 7))}/${Number(today.slice(8))}までの目標`
      : "現時点の目標";
    return { dailySum, cumTarget, cumLabel, actualTotal, retailTotal, retailDays, inMonth };
  }, [days, today]);

  const dineTotal = actualTotal - retailTotal;

  // B: ストリーク。店内の売上が入っている営業日だけを時系列で見る
  //    （休業日は数えない・途切れさせない。物販は日毎の判定には入れない）
  const { currentStreak, bestStreak, latest } = useMemo(() => {
    const judged = days.filter((d) => d.target != null && d.target > 0 && d.dineIn != null);
    let currentStreak = 0;
    for (let i = judged.length - 1; i >= 0; i--) {
      if (hitOf(judged[i])) currentStreak++;
      else break;
    }
    let bestStreak = 0;
    let run = 0;
    for (const d of judged) {
      if (hitOf(d)) {
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

  // A: 祝うのは「最新の日の店内が達成」or「月間（物販込み）が達成」
  //    左右で基準が違うのは意図的。前者は今日の店の地力、後者は今月のゴール。
  const latestHit = latest !== null && hitOf(latest);
  const monthlyHit = monthTarget > 0 && actualTotal >= monthTarget;

  // D: ゲージと着地予測
  //    伸ばすのは店内だけ。物販は不定期の単発なので、月末まで同じ率で続く前提が成り立たない
  //    （月初に62万入ると予測が跳ねて2000万になる）。既に入った物販はそのまま足す。
  const progress = monthTarget > 0 ? Math.max(0, Math.min(100, (actualTotal / monthTarget) * 100)) : 0;
  const paceBase = dailySum > 0 ? dailySum : monthTarget; // 月の商売の分布は日毎目標が知っている
  const forecast =
    inMonth && cumTarget > 0 && dineTotal > 0
      ? retailTotal + Math.round((dineTotal * paceBase) / cumTarget)
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
      {/* 左は店内の達成、右は月間（物販込み）の達成。基準が違うので片方だけ直さないこと */}
      {(latestHit || monthlyHit) && <Confetti />}

      {/* A: 達成のお祝い */}
      {monthlyHit ? (
        <section className="card cheer cheer--month">
          <span className="cheer__big">🏆 月間目標達成！！</span>
          <span>
            {fmtYen(monthTarget)} を超えました（＋{fmtYen(actualTotal - monthTarget)}）
          </span>
          {retailTotal > 0 ? (
            <span className="micro">うち物販 {fmtYen(retailTotal)}</span>
          ) : null}
        </section>
      ) : latestHit && latest ? (
        <section className="card cheer">
          <span>
            🎉 {Number(latest.date.slice(5, 7))}/{Number(latest.date.slice(8))} 目標達成！{" "}
            <strong>{fmtYen(latest.dineIn!)}</strong>
            <span className="micro">（＋{fmtYen(latest.dineIn! - latest.target!)}）</span>
          </span>
          {latest.retail > 0 ? (
            <span className="micro">この日は物販も {fmtYen(latest.retail)}</span>
          ) : null}
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
              <span className="salesnum--hit">目標達成 ＋{fmtYen(shownRemaining)}</span>
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

      {/* 現時点（月初〜今日の日毎目標の累計）に対する実績。ここは物販込みの合計で見る */}
      <section className="summary">
        <div className="summary__item">
          <span className={`summary__num ${onPace ? "salesnum--hit" : ""}`}>
            {fmtYen(shownActual)}
          </span>
          <span className="summary__label">{retailTotal > 0 ? "実績（物販こみ）" : "実績"}</span>
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

      {/* 物販の別枠。物販があった月だけ出す（無い月に「¥0」の枠は出さない） */}
      {retailTotal > 0 ? (
        <section className="card retail">
          <p className="micro" style={{ letterSpacing: "0.12em", margin: 0 }}>
            今月の物販
          </p>
          <p className="retail__num">{fmtYen(retailTotal)}</p>

          <ul className="retail__days">
            {retailDays.map((d) => (
              <li key={d.date}>
                <span>
                  {Number(d.date.slice(5, 7))}/{d.day}（{d.dowLabel}）
                </span>
                <strong>{fmtYen(d.retail)}</strong>
              </li>
            ))}
          </ul>

          <p className="retail__sum">
            店内 {fmtYen(Math.max(0, dineTotal))} ＋ 物販 {fmtYen(retailTotal)} ＝ 合計{" "}
            <strong>{fmtYen(actualTotal)}</strong>
          </p>
          {cumTarget > 0 ? (
            <p className="micro" style={{ margin: 0 }}>
              店内だけのペースは {rate1(Math.max(0, dineTotal), cumTarget).toFixed(1)}%。
            </p>
          ) : null}
          <p className="micro" style={{ margin: 0 }}>
            物販は日毎の売上には入れず、月間の合計にだけ入れています。
          </p>
        </section>
      ) : null}

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
          const hit = hitOf(d);
          const dine = shownYen(d.dineIn);
          return (
            <Link
              key={d.date}
              href={`/day/${d.date}`}
              className={`salescell ${d.closed ? "salescell--closed" : ""} ${d.isToday ? "salescell--today" : ""} ${hit ? "salescell--hit" : ""}`}
              aria-label={`${d.day}日 目標${d.target ? fmtYen(d.target) : "なし"} 店内${dine != null ? fmtYen(dine) : "なし"}${d.retail > 0 ? ` 物販${fmtYen(d.retail)}` : ""}`}
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
                    {dine != null ? dine.toLocaleString() : "ー"}
                  </span>
                  <span className="salescell__t">{d.target ? d.target.toLocaleString() : ""}</span>
                </>
              )}
              {/* 休業日に物販だけ売った日も、どこにも出ないということが無いように */}
              {d.retail > 0 ? <span className="salescell__r">＋物販</span> : null}
            </Link>
          );
        })}
      </div>

      <p className="micro" style={{ textAlign: "center", margin: 0 }}>
        上段＝店内の売上（<span className="salesnum--hit">金色に光る日＝目標達成</span>）・下段＝目標（円）。
        物販があった日は「＋物販」と出ます。タップでその日の詳細へ。
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
              店内の売上が目標を達成した日に出勤していた人に⭐がつきます。
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
