/*
 *   node --test "src/lib/cost.test.ts"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  draftFromAi,
  monthCost,
  prevYm,
  purchaseWarnings,
  salesExTax,
  stockTotal,
  totalMismatch,
  vendorKey,
  type Purchase,
} from "./cost.ts";

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

test("原価率は棚卸が月初・月末そろったときだけ。無ければ理由と仕入率だけ出す", () => {
  const sales = [{ biz_date: "a", target_yen: null, actual_yen: 1_100_000, tax8_yen: null, tax10_yen: null }];
  const purchases = [p({ food_ex: 300_000, drink_ex: 50_000, supplies_ex: 40_000 })];

  const none = monthCost({ sales, purchases, open: null, close: null });
  assert.equal(none.ratio, null);
  assert.equal(none.purchaseRatio, 35); // 350,000 / 1,000,000
  assert.deepEqual(none.missing, ["月初の在庫（前の月の棚卸）", "月末の棚卸"]);

  // 下書きの棚卸は使わない
  const draft = monthCost({ sales, purchases, open: { ym: "2026-10", status: "done", total_ex: 80_000 }, close: { ym: "2026-11", status: "draft", total_ex: null } });
  assert.equal(draft.ratio, null);

  const ok = monthCost({
    sales,
    purchases,
    open: { ym: "2026-10", status: "done", total_ex: 80_000 },
    close: { ym: "2026-11", status: "done", total_ex: 100_000 },
  });
  assert.equal(ok.cogs, 330_000); // 80,000 + 350,000 − 100,000
  assert.equal(ok.ratio, 33);
  assert.equal(ok.ratioWithSupplies, 37);
  assert.deepEqual(ok.missing, []);
});

test("売上が1日も無い月は率を出さない", () => {
  const r = monthCost({ sales: [], purchases: [p({ food_ex: 1000 })], open: null, close: null });
  assert.equal(r.purchaseRatio, null);
  assert.ok(r.missing.includes("売上"));
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

test("前の月", () => {
  assert.equal(prevYm("2026-01"), "2025-12");
  assert.equal(prevYm("2026-11"), "2026-10");
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
