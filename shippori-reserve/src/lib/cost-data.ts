import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthRange } from "@/lib/time";
import type { LossReason, Purchase, PurchaseStatus, Stocktake } from "@/lib/cost";
import type { SalesDay } from "@/lib/sales";

/*
 * 原価の読み出し。表はすべて利用者のログイン（RLS）で読む——権限の無い人には0行が返る。
 * 写真だけは非公開の置き場なので、サーバーが短い時間だけ有効なURLを作る（呼ぶ側で権限を見てから）。
 */

import { COST_BUCKET } from "@/lib/cost";
export { COST_BUCKET };

/** ロス。写真だけ撮った行（読み取り待ち）は品名・金額・理由がまだ空 */
export type Loss = {
  id: string;
  biz_date: string;
  item: string | null;
  amount_ex: number | null;
  reason: LossReason | null;
  memo: string | null;
  photo_path: string | null;
  created_by: string | null;
  status: PurchaseStatus;
  ai_note: string | null;
};

export type StockItem = {
  id: string;
  name: string;
  unit: string;
  unit_price: number;
  category: "food" | "drink";
  sort: number;
  active: boolean;
};

export type StockCount = { item_id: string; qty: number; unit_price: number };

export async function getMonthPurchases(ym: string): Promise<Purchase[]> {
  const { from, to } = monthRange(ym);
  return getPurchasesRange(from, to);
}

/** 計上日が from〜to の書類（月締めの請求書の日割りのため、呼ぶ側で to を少し先まで広げて使う） */
export async function getPurchasesRange(from: string, to: string): Promise<Purchase[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cost_purchases")
    .select("id, book_date, vendor, doc_kind, food_ex, drink_ex, supplies_ex, other_ex, total_in, period_from, period_to, memo, photo_path, ai_read, status, ai_note")
    .gte("book_date", from)
    .lte("book_date", to)
    .order("book_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) console.error("[cost] purchases", error.message);
  return (data ?? []) as Purchase[];
}

export async function getMonthLosses(ym: string): Promise<Loss[]> {
  const { from, to } = monthRange(ym);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cost_losses")
    .select("id, biz_date, item, amount_ex, reason, memo, photo_path, created_by, status, ai_note")
    .gte("biz_date", from)
    .lte("biz_date", to)
    .order("biz_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) console.error("[cost] losses", error.message);
  return (data ?? []) as Loss[];
}

/** 棚卸（新しい順・最近の2年ぶん）。週1回なので多くても100件ほど */
export async function getStocktakes(since: string): Promise<Stocktake[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cost_stocktakes")
    .select("as_of, counted_on, timing, status, total_ex")
    .gte("as_of", since)
    .order("as_of", { ascending: false });
  if (error) console.error("[cost] stocktakes", error.message);
  return (data ?? []) as Stocktake[];
}

/** 日ごとの売上（from〜to）。原価の期間は月をまたぐので月単位ではなく日付で読む */
export async function getSalesRange(from: string, to: string): Promise<Map<string, SalesDay>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_daily")
    .select("biz_date, target_yen, actual_yen, tax8_yen, tax10_yen")
    .gte("biz_date", from)
    .lte("biz_date", to);
  if (error) console.error("[cost] sales", error.message);
  return new Map((data ?? []).map((r) => [r.biz_date as string, r as SalesDay]));
}

export async function getStockItems(): Promise<StockItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cost_stock_items")
    .select("id, name, unit, unit_price, category, sort, active")
    .order("sort")
    .order("created_at");
  if (error) console.error("[cost] items", error.message);
  return (data ?? []) as StockItem[];
}

export async function getStockCounts(asOf: string): Promise<StockCount[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("cost_stock_counts").select("item_id, qty, unit_price").eq("as_of", asOf);
  if (error) console.error("[cost] counts", error.message);
  return (data ?? []).map((r) => ({ item_id: r.item_id as string, qty: Number(r.qty), unit_price: r.unit_price as number }));
}

/** 写真の一時URL（1時間）。権限の確認は呼ぶ側で済ませること */
export async function signedPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(paths.filter(Boolean))];
  if (uniq.length === 0) return {};
  try {
    const { data } = await createAdminClient().storage.from(COST_BUCKET).createSignedUrls(uniq, 3600);
    const out: Record<string, string> = {};
    for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
    return out;
  } catch (e) {
    console.error("[cost] signed urls", e);
    return {};
  }
}
