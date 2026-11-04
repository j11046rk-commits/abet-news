/*
 *   node --test "src/lib/haccp.test.ts"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blankCriteria,
  dayHaccp,
  judgeBatch,
  judgeTemp,
  newMenu,
  newPlanContent,
  planForDate,
  planIssues,
  requiredChecks,
  stepsFor,
  toCsv,
  weekStart,
  type PlanContent,
} from "./haccp.ts";

const header = { store_name: "おばんざい家庭料理 しっぽり亭", hygiene_manager: "山田", author_name: "古賀", effective_from: "2026-11-10" };

function readyPlan(): PlanContent {
  const c = newPlanContent();
  for (const g of c.general) {
    g.who = "店長";
  }
  c.equipment.push({ id: "e1", name: "冷蔵庫1", kind: "fridge", maxC: 10, minC: null, timings: ["pre", "close"], basis: "" });
  const m = newMenu("m1");
  m.name = "肉じゃが";
  m.group = "g3";
  m.variant = "reheat";
  m.hazards = "ウェルシュ菌";
  m.criteria = {
    heat: { mode: "measure", minC: 75, holdSec: 60, visual: "" },
    cool: { targetC: 20, withinMin: 30 },
    chill: { maxC: 10 },
    reheat: { mode: "measure", minC: 75, holdSec: 60, visual: "" },
  };
  m.method = "中心温度計";
  m.frequency = "仕込みのたび";
  m.storage = "小分けして冷蔵庫1";
  m.useByRule = "店で決めた日数";
  m.onFail = "廃棄";
  m.batchRecord = true;
  c.menus.push(m);
  c.cc.g3.who = "店長";
  c.cc.g3.onProblem = "廃棄";
  return c;
}

test("初期の下書きは未設定だらけで、確定できない（誰が・設備・メニューは空のまま）", () => {
  const c = newPlanContent();
  assert.equal(c.equipment.length, 0);
  assert.equal(c.menus.length, 0);
  assert.ok(c.general.every((g) => g.who === ""));
  const issues = planIssues({ store_name: null, hygiene_manager: null, author_name: null, effective_from: null }, c);
  assert.ok(!issues.some((s) => s.includes("誰が"))); // 誰がは任意
  assert.ok(issues.includes("食品衛生責任者が未設定です"));
  assert.ok(issues.includes("冷蔵庫・冷凍庫が1台も登録されていません"));
  assert.ok(issues.includes("重要管理のメニューが1つも登録されていません"));
});

test("すべて埋まれば確定できる", () => {
  assert.deepEqual(planIssues(header, readyPlan()), []);
});

test("最低限の計画：料理名・グループ・確認方法だけで確定できる（誰が・危害要因などは任意）", () => {
  const c = newPlanContent();
  c.equipment.push({ id: "e1", name: "冷蔵庫1", kind: "fridge", maxC: 10, minC: null, timings: ["close"], basis: "" });
  const m = newMenu("m1");
  m.name = "煮物";
  m.group = "g3";
  m.variant = "reheat";
  m.method = "冷ましてから冷蔵庫へ";
  c.menus.push(m);
  assert.equal(m.batchRecord, false); // 仕込みごとの記録は既定で付けない
  assert.deepEqual(planIssues(header, c), []);
});

test("記録は1日1回（営業終了時）にまとめ、店で足した⑤は最初は外してある", () => {
  const keys = requiredChecks(newPlanContent()).map((r) => r.key);
  assert.ok(keys.every((k) => k.endsWith(":close")));
  assert.ok(!keys.includes("gen:kitchen:close"));
  assert.equal(keys.length, 6);
});

test("仕込みごとに記録する第3グループは、店舗で決めた使用期限がないと確定できない（日数の候補は出さない）", () => {
  const c = readyPlan();
  c.menus[0].useByRule = "";
  assert.ok(planIssues(header, c).some((s) => s.includes("使用期限")));
});

test("二枚貝に一般的な加熱条件（75℃1分）は当てはめない", () => {
  const c = readyPlan();
  c.menus[0].special.bivalve = true;
  assert.ok(planIssues(header, c).some((s) => s.includes("二枚貝")));
  c.menus[0].criteria.heat = { mode: "measure", minC: 85, holdSec: 90, visual: "" };
  assert.ok(!planIssues(header, c).some((s) => s.includes("二枚貝")));
});

test("低温調理・生食用魚介類は根拠と管理方法が必要", () => {
  const c = readyPlan();
  c.menus[0].special.lowTemp = true;
  c.menus[0].special.rawSeafood = true;
  const issues = planIssues(header, c);
  assert.ok(issues.some((s) => s.includes("低温調理")));
  assert.ok(issues.some((s) => s.includes("生食用魚介類")));
});

test("工程の分類は料理名ではなく工程で決まる", () => {
  assert.deepEqual(stepsFor("g3", "reheat"), ["heat", "cool", "chill", "reheat"]);
  assert.deepEqual(stepsFor("g3", "cold"), ["heat", "cool", "chill"]);
  assert.deepEqual(stepsFor("g2", "hot_hold"), ["heat", "hotHold"]);
  assert.deepEqual(stepsFor("", ""), []);
  assert.deepEqual(Object.keys(blankCriteria(["heat", "cool"])), ["heat", "cool"]);
  assert.equal(blankCriteria(["heat"]).heat?.minC, null); // 値は入れない
});

test("1日に記録すること：タイミングごと・設備ごと・使っているグループだけ", () => {
  const keys = requiredChecks(readyPlan()).map((r) => r.key);
  assert.ok(keys.includes("eq:e1:pre") && keys.includes("eq:e1:close"));
  assert.ok(keys.includes("gen:receiving:close"));
  assert.ok(keys.includes("cc:g3:close"));
  assert.ok(!keys.some((k) => k.startsWith("cc:g1"))); // 第1グループの料理は無い
  assert.ok(!keys.some((k) => k.startsWith("gen:fridge"))); // 冷蔵庫は設備ごと
});

test("温度の判定（冷蔵は上限、冷凍はマイナス）", () => {
  assert.equal(judgeTemp({ maxC: 10, minC: null }, 8), "ok");
  assert.equal(judgeTemp({ maxC: 10, minC: null }, 12.5), "ng");
  assert.equal(judgeTemp({ maxC: -15, minC: null }, -18), "ok");
  assert.equal(judgeTemp({ maxC: -15, minC: null }, -10), "ng");
  assert.equal(judgeTemp({ maxC: null, minC: null }, 3), null);
});

test("冷却：時間と到達温度。途中は判定しない", () => {
  const steps = stepsFor("g3", "reheat");
  const cr = readyPlan().menus[0].criteria;
  const heat = { tempC: 80, holdSec: 60 };
  assert.equal(judgeBatch(steps, cr, { heat, cool: { startAt: "2026-11-10T15:00:00+09:00" } }).judgement, "pending");
  const late = judgeBatch(steps, cr, {
    heat,
    cool: { startAt: "2026-11-10T15:00:00+09:00", endAt: "2026-11-10T15:50:00+09:00", endTempC: 18 },
  });
  assert.equal(late.steps.cool, "ng");
  assert.equal(late.judgement, "ng");
  const ok = judgeBatch(steps, cr, {
    heat,
    cool: { startAt: "2026-11-10T15:00:00+09:00", endAt: "2026-11-10T15:25:00+09:00", endTempC: 18 },
    chill: { tempC: 5 },
    reheat: { tempC: 80, holdSec: 60 },
  });
  assert.equal(ok.judgement, "ok");
});

test("加熱：温度と保持時間はセット。見た目で確認する基準も扱える", () => {
  const cr = { heat: { mode: "measure" as const, minC: 75, holdSec: 60, visual: "" } };
  assert.equal(judgeBatch(["heat"], cr, { heat: { tempC: 80, holdSec: 30 } }).judgement, "ng");
  assert.equal(judgeBatch(["heat"], cr, { heat: { tempC: 80 } }).judgement, "pending");
  const vis = { heat: { mode: "visual" as const, minC: null, holdSec: null, visual: "肉汁が透明" } };
  assert.equal(judgeBatch(["heat"], vis, { heat: { ok: false } }).judgement, "ng");
  assert.equal(judgeBatch(["heat"], vis, { heat: { ok: true } }).judgement, "ok");
});

test("1日の状態：未記録・一部・完了・休業・計画なし・これからを区別し、過ぎた日だけアラート", () => {
  const base = { today: "2026-11-12", hasPlan: true, isClosed: false, required: ["a", "b"], ng: 0, open: 0 };
  assert.deepEqual(
    [
      dayHaccp({ ...base, date: "2026-11-11", filled: [] }).state,
      dayHaccp({ ...base, date: "2026-11-11", filled: ["a"] }).state,
      dayHaccp({ ...base, date: "2026-11-11", filled: ["a", "b"] }).state,
      dayHaccp({ ...base, date: "2026-11-11", filled: [], isClosed: true }).state,
      dayHaccp({ ...base, date: "2026-11-11", filled: [], hasPlan: false }).state,
      dayHaccp({ ...base, date: "2026-11-13", filled: [] }).state,
    ],
    ["none", "partial", "complete", "closed", "noplan", "future"],
  );
  assert.equal(dayHaccp({ ...base, date: "2026-11-11", filled: ["a"] }).alert, true);
  assert.equal(dayHaccp({ ...base, date: "2026-11-12", filled: [] }).alert, false); // 今日はまだ途中
  assert.equal(dayHaccp({ ...base, date: "2026-11-11", filled: [], isClosed: true }).alert, false);
});

test("その日に使う計画：適用開始日で選ぶ（下書きは使わない）", () => {
  const plans = [
    { version: 1, status: "superseded", effective_from: "2026-11-10" },
    { version: 2, status: "approved", effective_from: "2026-12-01" },
    { version: 3, status: "draft", effective_from: "2026-11-01" },
  ];
  assert.equal(planForDate(plans, "2026-11-09"), null);
  assert.equal(planForDate(plans, "2026-11-20")?.version, 1);
  assert.equal(planForDate(plans, "2026-12-05")?.version, 2);
});

test("週の始まりは月曜", () => {
  assert.equal(weekStart("2026-11-04"), "2026-11-02"); // 水曜
  assert.equal(weekStart("2026-11-08"), "2026-11-02"); // 日曜
  assert.equal(weekStart("2026-11-09"), "2026-11-09");
});

test("CSV：BOM付き・空欄は空欄のまま・式は実行させない・負の温度はそのまま", () => {
  const csv = toCsv([["日付", "結果"], ["2026-11-10", null], ["=1+1", -18], ["a,b", '"x"']]);
  assert.ok(csv.startsWith("﻿日付,結果\r\n"));
  assert.ok(csv.includes("2026-11-10,\r\n"));
  assert.ok(csv.includes("'=1+1,-18\r\n"));
  assert.ok(csv.includes('"a,b","""x"""'));
});

test("温度計で自動記録する設備は、毎日の入力にも「記録完了」の判定にも入らない（帳票には並ぶ）", () => {
  const c = newPlanContent();
  c.equipment.push({ id: "f1", name: "冷凍①", kind: "freezer", maxC: -15, minC: null, timings: [], basis: "", auto: true });
  c.equipment.push({ id: "r1", name: "冷蔵①", kind: "fridge", maxC: 10, minC: null, timings: ["close"], basis: "" });
  const daily = requiredChecks(c).map((r) => r.key);
  assert.ok(!daily.includes("eq:f1:close") && daily.includes("eq:r1:close"));
  assert.ok(requiredChecks(c, true).some((r) => r.key === "eq:f1:close"));
  // 自動の設備は「測るとき」を決めなくても確定できる
  assert.ok(!planIssues(header, c).some((s) => s.includes("冷凍①：測るタイミング")));
});
