import type { CashSession, MttEntry } from '../types';

/** 値を [min, max] にクランプ。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 推定ハンド/時（ライブ想定・HANDOFF §4）。
 * handsPerHour(players) = round( 25 * (9 / clamp(players,2,10)) ^ 0.7 )
 */
export function handsPerHour(players: number): number {
  const p = clamp(players, 2, 10);
  return Math.round(25 * Math.pow(9 / p, 0.7));
}

export type CashStats = {
  totalHands: number;
  totalProfit: number;
  totalHours: number;
  sumBB: number;
  bb100: number; // NaN if no hands
  hourly: number; // NaN if no hours
  count: number;
};

/** キャッシュ累計（HANDOFF §4）。 */
export function cashStats(sessions: readonly CashSession[]): CashStats {
  let totalHands = 0;
  let totalProfit = 0;
  let totalHours = 0;
  let sumBB = 0;

  for (const s of sessions) {
    totalHands += s.hours * s.hph;
    totalProfit += s.profit;
    totalHours += s.hours;
    // セッションごとにBBが違うのでBB換算して合算
    if (s.bb > 0) sumBB += s.profit / s.bb;
  }

  const bb100 = totalHands > 0 ? sumBB / (totalHands / 100) : NaN;
  const hourly = totalHours > 0 ? totalProfit / totalHours : NaN;

  return {
    totalHands,
    totalProfit,
    totalHours,
    sumBB,
    bb100,
    hourly,
    count: sessions.length,
  };
}

export type MttStats = {
  invested: number;
  cashes: number;
  roi: number; // % ・ NaN if no investment
  itm: number; // % ・ NaN if no entries
  avgTop: number; // % ・ NaN if no entries
  streak: number; // 現在のノーマネー連続
  best: number; // 最高賞金
  mttProfit: number;
  count: number;
};

/** トーナメント累計（HANDOFF §4）。 */
export function mttStats(entries: readonly MttEntry[]): MttStats {
  const n = entries.length;
  let invested = 0;
  let cashes = 0;
  let sumTop = 0;
  let best = 0;

  for (const e of entries) {
    invested += e.buyin * (1 + e.rebuys);
    cashes += e.cash;
    if (e.field > 0) sumTop += e.finish / e.field;
    if (e.cash > best) best = e.cash;
  }

  const roi = invested > 0 ? ((cashes - invested) / invested) * 100 : NaN;
  const itmCount = entries.filter((e) => e.cash > 0).length;
  const itm = n > 0 ? (itmCount / n) * 100 : NaN;
  const avgTop = n > 0 ? (sumTop / n) * 100 : NaN;

  // 直近（日付降順）から連続で cash=0 が続く数
  const byDateDesc = [...entries].sort((a, b) => b.date - a.date);
  let streak = 0;
  for (const e of byDateDesc) {
    if (e.cash === 0) streak += 1;
    else break;
  }

  return {
    invested,
    cashes,
    roi,
    itm,
    avgTop,
    streak,
    best,
    mttProfit: cashes - invested,
    count: n,
  };
}

/** 実収支トータル（成績タブのヘッドライン・HANDOFF §4）。 */
export function grandTotal(cash: CashStats, mtt: MttStats): number {
  return cash.totalProfit + mtt.mttProfit;
}
