/*
 *   node --test "src/lib/cost.test.ts"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asOfFor,
  draftFromAi,
  lastSunday,
  parseAiDoc,
  periodCost,
  purchaseShare,
  purchaseWarnings,
  stockPeriods,
  salesExTax,
  stockTotal,
  totalMismatch,
  vendorKey,
  type Purchase,
  type Stocktake,
} from "./cost.ts";
import type { SalesDay } from "./sales.ts";

const day = (biz_date: string, actual_yen: number): [string, SalesDay] => [
  biz_date,
  { biz_date, target_yen: null, actual_yen, tax8_yen: null, tax10_yen: null },
];
const st = (as_of: string, total_ex: number | null, status: "draft" | "done" = "done"): Stocktake => ({
  as_of,
  counted_on: as_of,
  timing: "after_close",
  status,
  total_ex,
});

const p = (over: Partial<Purchase>): Purchase => ({
  id: Math.random().toString(36).slice(2),
  book_date: "2026-11-10",
  vendor: "業者A",
  doc_kind: "slip",
  food_ex: 0,
  drink_ex: 0,
  supplies_ex: 0,
  other_ex: 0,
  total_in: null,
  ...over,
});

test("売上は税抜にする（店内10%・物販8%）", () => {
  assert.equal(salesExTax({ biz_date: "x", target_yen: null, actual_yen: 110_000, tax8_yen: null, tax10_yen: null }), 100_000);
  // 合計 118,000 のうち物販 8,000（8%）→ 店内 110,000/1.1 + 8,000/1.08
  assert.equal(
    salesExTax({ biz_date: "x", target_yen: null, actual_yen: 118_000, tax8_yen: 8_000, tax10_yen: null }),
    Math.round(100_000 + 8_000 / 1.08),
  );
  assert.equal(salesExTax({ biz_date: "x", target_yen: 50_000, actual_yen: null, tax8_yen: null, tax10_yen: null }), null);
});

test("原価率は棚卸が両端にそろったときだけ。無ければ理由と仕入率だけ出す", () => {
  const sales = new Map([day("2026-11-10", 1_100_000)]);
  const purchases = [p({ food_ex: 300_000, drink_ex: 50_000, supplies_ex: 40_000 })];
  const span = { from: "2026-11-10", to: "2026-11-16", sales, purchases };

  const none = periodCost({ ...span, open: null, close: null });
  assert.equal(none.ratio, null);
  assert.equal(none.purchaseRatio, 35); // 350,000 / 1,000,000
  assert.deepEqual(none.missing, ["始めの棚卸", "終わりの棚卸"]);

  // 下書きの棚卸は使わない
  const draft = periodCost({ ...span, open: st("2026-11-09", 80_000), close: st("2026-11-16", null, "draft") });
  assert.equal(draft.ratio, null);

  const ok = periodCost({ ...span, open: st("2026-11-09", 80_000), close: st("2026-11-16", 100_000) });
  assert.equal(ok.cogs, 330_000); // 80,000 + 350,000 − 100,000
  assert.equal(ok.ratio, 33);
  assert.equal(ok.ratioWithSupplies, 37);
  assert.deepEqual(ok.missing, []);
});

test("期間の外の売上・仕入は数えない", () => {
  const sales = new Map([day("2026-11-09", 550_000), day("2026-11-10", 110_000), day("2026-11-17", 550_000)]);
  const r = periodCost({
    from: "2026-11-10",
    to: "2026-11-16",
    sales,
    purchases: [p({ book_date: "2026-11-09", food_ex: 9_999 }), p({ book_date: "2026-11-16", food_ex: 30_000 })],
    open: null,
    close: null,
  });
  assert.equal(r.salesEx, 100_000);
  assert.equal(r.salesDays, 1);
  assert.equal(r.food, 30_000);
});

test("売上が1日も無い期間は率を出さない", () => {
  const r = periodCost({ from: "2026-11-10", to: "2026-11-16", sales: new Map(), purchases: [p({ food_ex: 1000 })], open: null, close: null });
  assert.equal(r.purchaseRatio, null);
  assert.ok(r.missing.includes("売上"));
});

test("毎週の棚卸：営業中・閉店後はその日まで、開店前は前の日までの在庫", () => {
  assert.equal(asOfFor("2026-11-15", "during"), "2026-11-15");
  assert.equal(asOfFor("2026-11-15", "before_open"), "2026-11-14");
  assert.equal(asOfFor("2026-11-15", "after_close"), "2026-11-15");
  assert.equal(asOfFor("2026-12-01", "before_open"), "2026-11-30");
  assert.equal(lastSunday("2026-11-15"), "2026-11-15"); // 日曜
  assert.equal(lastSunday("2026-11-18"), "2026-11-15"); // 水曜
  assert.equal(lastSunday("2026-11-14"), "2026-11-08"); // 土曜
});

test("確定した棚卸の間ごとに区間を作る（下書きは飛ばす）", () => {
  const ps = stockPeriods([st("2026-11-22", 90_000), st("2026-11-08", 100_000), st("2026-11-15", 0, "draft"), st("2026-11-29", 95_000)]);
  assert.deepEqual(
    ps.map((x) => [x.from, x.to, x.open.total_ex, x.close.total_ex]),
    [
      ["2026-11-09", "2026-11-22", 100_000, 90_000],
      ["2026-11-23", "2026-11-29", 90_000, 95_000],
    ],
  );
  assert.deepEqual(stockPeriods([st("2026-11-08", 1)]), []);
});

test("月締めの請求書は対象期間で日割り（締め日の週だけ跳ねない）。納品書は計上日で丸ごと", () => {
  const inv = p({ doc_kind: "invoice", book_date: "2026-11-20", period_from: "2026-10-21", period_to: "2026-11-20", food_ex: 31_000 });
  assert.equal(purchaseShare(inv, "2026-11-10", "2026-11-16"), 7 / 31);
  assert.equal(purchaseShare(inv, "2026-11-21", "2026-11-27"), 0);
  assert.equal(purchaseShare(inv, "2026-10-01", "2026-12-31"), 1);
  // 期間が読めていない請求書は締め日で丸ごと
  assert.equal(purchaseShare({ ...inv, period_from: null }, "2026-11-17", "2026-11-23"), 1);
  assert.equal(purchaseShare(p({ book_date: "2026-11-16" }), "2026-11-10", "2026-11-16"), 1);

  const r = periodCost({ from: "2026-11-10", to: "2026-11-16", sales: new Map(), purchases: [inv], open: null, close: null });
  assert.equal(r.food, 7_000);
  assert.equal(r.prorated, true);
});

test("二重計上の警告：同じ業者の請求書と納品書、同じ日・同じ金額", () => {
  const w1 = purchaseWarnings([
    p({ vendor: "株式会社 丸魚", doc_kind: "slip", food_ex: 1000 }),
    p({ vendor: "丸魚", doc_kind: "invoice", food_ex: 30000, book_date: "2026-11-30" }),
  ]);
  assert.equal(w1.length, 1);
  assert.ok(w1[0]!.text.includes("請求書と納品書"));

  const w2 = purchaseWarnings([p({ vendor: "業務スーパー", doc_kind: "receipt", food_ex: 1234 }), p({ vendor: "業務ｽｰﾊﾟｰ", doc_kind: "receipt", food_ex: 1234 })]);
  assert.equal(w2.length, 1);
  assert.ok(w2[0]!.text.includes("2件"));

  assert.deepEqual(purchaseWarnings([p({ vendor: "A", food_ex: 1 }), p({ vendor: "B", food_ex: 1 })]), []);
  assert.equal(vendorKey("（株）丸魚 "), vendorKey("丸魚"));
});

test("棚卸の在庫額：空欄（数えていない）は足さない。0は0として数える", () => {
  assert.equal(stockTotal([{ qty: 2, unit_price: 1500 }, { qty: null, unit_price: 9999 }, { qty: 0, unit_price: 500 }, { qty: 0.5, unit_price: 3001 }]), 4501);
});

test("AIの読み取り→確認画面の初期値：税込は区分の税率で税抜に戻す・請求書は締め日で計上", () => {
  const d = draftFromAi(
    {
      doc_kind: "invoice",
      vendor: " 丸魚 ",
      date: "2026-12-05",
      period_from: "2026-11-01",
      period_to: "2026-11-30",
      total_in: 108_000,
      lines: [{ category: "food", amount: 108_000, tax_included: true, tax_rate: null }],
      note: "",
    },
    "2026-12-06",
  );
  assert.equal(d.book_date, "2026-11-30");
  assert.equal(d.vendor, "丸魚");
  assert.equal(d.food_ex, 100_000);
  assert.equal(totalMismatch(d), null);

  const r = draftFromAi(
    {
      doc_kind: "receipt",
      vendor: "スーパー",
      date: "読めない",
      period_from: null,
      period_to: null,
      total_in: 2_180,
      lines: [
        { category: "food", amount: 1_080, tax_included: true, tax_rate: 0.08 },
        { category: "supplies", amount: 1_000, tax_included: false, tax_rate: 0.1 },
      ],
      note: "",
    },
    "2026-11-05",
  );
  assert.equal(r.book_date, "2026-11-05"); // 日付が読めなければ今日
  assert.equal(r.food_ex, 1_000);
  assert.equal(r.supplies_ex, 1_000);
  assert.equal(totalMismatch(r), null);
  assert.ok(totalMismatch({ ...r, total_in: 5_000 }) != null); // 読み違いは知らせる
});

test("読み取り待ちは原価にも二重の警告にも入れない", () => {
  const pending = p({ status: "pending", vendor: null, food_ex: 0 });
  const r = periodCost({
    from: "2026-11-01",
    to: "2026-11-30",
    sales: new Map([day("2026-11-10", 110_000)]),
    purchases: [pending, p({ status: "unconfirmed", food_ex: 10_000 })],
    open: null,
    close: null,
  });
  assert.equal(r.food, 10_000); // 未確認は入る（金額は読めている）
  assert.deepEqual(purchaseWarnings([pending, pending]), []);
});

test("読み取り役から届いた結果の検査：外から来るので形を全部見る", () => {
  const good = {
    doc_kind: "slip",
    vendor: "丸魚",
    date: "2026-11-05",
    period_from: null,
    period_to: null,
    total_in: 10_800,
    lines: [{ category: "food", amount: 10_800, tax_included: true, tax_rate: 0.08 }],
    note: "",
  };
  assert.equal(parseAiDoc(good).ok, true);
  assert.equal(parseAiDoc({ ...good, doc_kind: "memo" }).ok, false);
  assert.equal(parseAiDoc({ ...good, vendor: " " }).ok, false);
  assert.equal(parseAiDoc({ ...good, lines: [] }).ok, false);
  assert.equal(parseAiDoc({ ...good, lines: [{ ...good.lines[0], amount: 1.5 }] }).ok, false);
  assert.equal(parseAiDoc({ ...good, lines: [{ ...good.lines[0], tax_rate: 0.05 }] }).ok, false);
  assert.equal(parseAiDoc({ ...good, date: 20261105 }).ok, false);
  assert.equal(parseAiDoc(null).ok, false);
});
