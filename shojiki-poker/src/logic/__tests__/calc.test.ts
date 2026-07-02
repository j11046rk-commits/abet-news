import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, handsPerHour, cashStats, mttStats, grandTotal } from '../calc.ts';
import { cashLevel, mttLevel, cashSampleWarning, mttSampleWarning } from '../levels.ts';
import type { CashSession, MttEntry } from '../../types.ts';

test('clamp bounds', () => {
  assert.equal(clamp(12, 2, 10), 10);
  assert.equal(clamp(1, 2, 10), 2);
  assert.equal(clamp(6, 2, 10), 6);
});

test('handsPerHour matches spec at anchor points', () => {
  assert.equal(handsPerHour(9), 25);
  assert.equal(handsPerHour(6), 33);
  assert.equal(handsPerHour(2), 72);
  assert.equal(handsPerHour(10), 23);
  // clamp beyond range
  assert.equal(handsPerHour(12), handsPerHour(10));
  assert.equal(handsPerHour(1), handsPerHour(2));
});

test('cashStats cumulative + bb/100', () => {
  const s: CashSession[] = [
    { id: '1', date: 1, bb: 1000, hours: 10, players: 9, hph: handsPerHour(9), profit: 50000 },
  ];
  const st = cashStats(s);
  assert.equal(st.totalHands, 250); // 10h * 25 hph
  assert.equal(st.totalProfit, 50000);
  assert.equal(st.totalHours, 10);
  assert.equal(st.sumBB, 50); // 50000 / 1000
  assert.equal(st.bb100, 20); // 50 / (250/100)
  assert.equal(st.hourly, 5000);
});

test('cashStats sums per-session BB correctly across differing rates', () => {
  const s: CashSession[] = [
    { id: '1', date: 1, bb: 1000, hours: 5, players: 9, hph: 25, profit: 25000 }, // +25bb, 125 hands
    { id: '2', date: 2, bb: 500, hours: 5, players: 9, hph: 25, profit: -5000 }, // -10bb, 125 hands
  ];
  const st = cashStats(s);
  assert.equal(st.sumBB, 15); // 25 + (-10)
  assert.equal(st.totalHands, 250);
  assert.equal(st.bb100, 6); // 15 / 2.5
});

test('cashStats empty -> NaN meters', () => {
  const st = cashStats([]);
  assert.ok(Number.isNaN(st.bb100));
  assert.ok(Number.isNaN(st.hourly));
});

test('mttStats cumulative + ROI/ITM/avgTop/streak', () => {
  const e: MttEntry[] = [
    { id: '1', date: 100, buyin: 10000, rebuys: 1, field: 100, finish: 5, cash: 30000 },
    { id: '2', date: 200, buyin: 10000, rebuys: 0, field: 50, finish: 25, cash: 0 },
  ];
  const st = mttStats(e);
  assert.equal(st.invested, 30000); // 10000*2 + 10000*1
  assert.equal(st.cashes, 30000);
  assert.equal(st.roi, 0);
  assert.equal(st.itm, 50);
  assert.ok(Math.abs(st.avgTop - 27.5) < 1e-9); // mean(0.05, 0.5)*100
  assert.equal(st.best, 30000);
  assert.equal(st.mttProfit, 0);
  assert.equal(st.streak, 1); // newest (date 200) is a whiff
});

test('mttStats streak counts consecutive whiffs from newest', () => {
  const e: MttEntry[] = [
    { id: '1', date: 100, buyin: 5000, rebuys: 0, field: 30, finish: 3, cash: 20000 },
    { id: '2', date: 200, buyin: 5000, rebuys: 0, field: 30, finish: 20, cash: 0 },
    { id: '3', date: 300, buyin: 5000, rebuys: 0, field: 30, finish: 25, cash: 0 },
  ];
  assert.equal(mttStats(e).streak, 2);
});

test('grandTotal combines cash + mtt', () => {
  const cash = cashStats([
    { id: '1', date: 1, bb: 1000, hours: 10, players: 9, hph: 25, profit: 50000 },
  ]);
  const mtt = mttStats([
    { id: '1', date: 1, buyin: 10000, rebuys: 0, field: 100, finish: 50, cash: 0 },
  ]);
  assert.equal(grandTotal(cash, mtt), 40000); // 50000 + (0 - 10000)
});

test('level thresholds (cash)', () => {
  assert.equal(cashLevel(8).label, '鉄強プレイヤー');
  assert.equal(cashLevel(5).label, '勝ち組');
  assert.equal(cashLevel(0).label, '肩次第');
  assert.equal(cashLevel(-1).label, 'お魚さん');
  assert.equal(cashLevel(NaN).label, '未計測');
});

test('level thresholds (mtt)', () => {
  assert.equal(mttLevel(30).label, '強豪');
  assert.equal(mttLevel(10).label, 'しっかりプラス');
  assert.equal(mttLevel(0).label, '薄利');
  assert.equal(mttLevel(-1).label, 'マイナス');
});

test('sample warnings appear below thresholds', () => {
  assert.ok(cashSampleWarning(4999));
  assert.equal(cashSampleWarning(5000), null);
  assert.ok(mttSampleWarning(49));
  assert.equal(mttSampleWarning(50), null);
});
