import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthRange } from "@/lib/time";
import type { LossReason, Purchase, Stocktake } from "@/lib/cost";

/*
 * 原価の読み出し。表はすべて利用者のログイン（RLS）で読む——権限の無い人には0行が返る。
 * 写真だけは非公開の置き場なので、サーバーが短い時間だけ有効なURLを作る（呼ぶ側で権限を見てから）。
 */

export const COST_BUCKET = "cost-photos";

export type Loss = {
  id: string;
  biz_date: string;
  item: string;
  amount_ex: number;
  reason: LossReason;
  memo: string | null;
  photo_path: string | null;
  created_by: string | null;
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
    .select("id, biz_date, item, amount_ex, reason, memo, photo_path, created_by")
    .gte("biz_date", from)
    .lte("biz_date", to)
    .order("biz_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) console.error("[cost] losses", error.message);
  return (data ?? []) as Loss[];
}

export async function getStocktakes(yms: string[]): Promise<Map<string, Stocktake>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("cost_stocktakes").select("ym, status, total_ex").in("ym", yms);
  if (error) console.error("[cost] stocktakes", error.message);
  return new Map((data ?? []).map((r) => [r.ym as string, r as Stocktake]));
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

export async function getStockCounts(ym: string): Promise<StockCount[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("cost_stock_counts").select("item_id, qty, unit_price").eq("ym", ym);
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
