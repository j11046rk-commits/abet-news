"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { can } from "@/lib/constants";
import { todayBizDate } from "@/lib/time";
import { draftFromAi, stockTotal, type DocKind, type LossReason, type PurchaseDraft } from "@/lib/cost";
import { readCostDocument } from "@/lib/cost-ai";
import { COST_BUCKET } from "@/lib/cost-data";

/*
 * 原価の書き込み。権限はここで見たうえで、DB でも RLS がもう一度見る。
 * 写真は非公開の置き場へサーバー（管理キー）が置く。
 */

export type CResult = { ok: true; id?: string } | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const PHOTO_MAX = 3.5 * 1024 * 1024;

const dbErr = (message: string | undefined, fallback: string): string => {
  const jp = message?.match(/[ぁ-んァ-ヶ一-龠][^\n]*/);
  return jp ? jp[0] : fallback;
};

async function canWrite() {
  const me = await requireProfile();
  return can(me.role, "cost.write") ? me : null;
}

function done() {
  revalidatePath("/sales/cost");
  revalidatePath("/sales/cost/stock");
}

/** 写真を置き場へ。戻り値は置いた場所（保存する行に書く） */
async function putPhoto(file: File, folder: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (!PHOTO_TYPES.includes(file.type as (typeof PHOTO_TYPES)[number])) {
    return { ok: false, error: "写真（JPEG・PNG）を選んでください。" };
  }
  if (file.size > PHOTO_MAX) return { ok: false, error: "写真が大きすぎます（3.5MBまで）。" };
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await createAdminClient()
    .storage.from(COST_BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (error) {
    console.error("[cost] upload", error.message);
    return { ok: false, error: "写真を保存できませんでした。" };
  }
  return { ok: true, path };
}

async function dropPhoto(path: string | null | undefined) {
  if (!path) return;
  await createAdminClient().storage.from(COST_BUCKET).remove([path]);
}

// ── 仕入 ─────────────────────────────────────────────────────

export type ReadResult =
  | { ok: true; photoPath: string; draft: PurchaseDraft | null; ai: "read" | "nokey" | "unreadable" | "error" }
  | { ok: false; error: string };

/** 写真を置いて、AIに読ませる。読めなくても写真は残し、手入力に切り替える */
export async function readPurchasePhoto(fd: FormData): Promise<ReadResult> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "写真を選んでください。" };

  const today = todayBizDate();
  const put = await putPhoto(file, `purchases/${today.slice(0, 7)}`);
  if (!put.ok) return put;

  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const r = await readCostDocument({ data, mediaType: file.type as "image/jpeg" | "image/png" | "image/webp" });
  if (!r.ok) return { ok: true, photoPath: put.path, draft: null, ai: r.reason };
  return { ok: true, photoPath: put.path, draft: draftFromAi(r.doc, today), ai: "read" };
}

export type PurchaseInput = {
  id?: string;
  book_date: string;
  vendor: string;
  doc_kind: DocKind;
  food_ex: number;
  drink_ex: number;
  supplies_ex: number;
  other_ex: number;
  total_in: number | null;
  period_from: string | null;
  period_to: string | null;
  memo: string;
  photo_path: string | null;
  ai_read: boolean;
};

const yen = (v: unknown, max = 10_000_000): number | null =>
  typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= max ? v : null;

export async function savePurchase(input: PurchaseInput): Promise<CResult> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  if (!DATE_RE.test(input.book_date)) return { ok: false, error: "計上日を入れてください。" };
  const vendor = input.vendor.trim();
  if (!vendor) return { ok: false, error: "業者・お店の名前を入れてください。" };
  if (!["slip", "invoice", "receipt"].includes(input.doc_kind)) return { ok: false, error: "書類の種類が不正です。" };
  const amounts = [input.food_ex, input.drink_ex, input.supplies_ex, input.other_ex].map((v) => yen(v));
  if (amounts.some((v) => v == null)) return { ok: false, error: "金額は円の整数で入れてください。" };
  if (amounts.every((v) => v === 0)) return { ok: false, error: "金額が全部0です。" };
  if (input.total_in != null && yen(input.total_in, 20_000_000) == null) return { ok: false, error: "合計（税込）が不正です。" };
  for (const d of [input.period_from, input.period_to]) {
    if (d && !DATE_RE.test(d)) return { ok: false, error: "請求の期間が不正です。" };
  }
  if (input.photo_path && !/^purchases\/\d{4}-\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(input.photo_path)) {
    return { ok: false, error: "写真の指定が不正です。" };
  }

  const row = {
    book_date: input.book_date,
    vendor: vendor.slice(0, 80),
    doc_kind: input.doc_kind,
    food_ex: input.food_ex,
    drink_ex: input.drink_ex,
    supplies_ex: input.supplies_ex,
    other_ex: input.other_ex,
    total_in: input.total_in,
    period_from: input.doc_kind === "invoice" ? input.period_from || null : null,
    period_to: input.doc_kind === "invoice" ? input.period_to || null : null,
    memo: input.memo.trim().slice(0, 500) || null,
    photo_path: input.photo_path,
    ai_read: input.ai_read,
  };
  const supabase = await createClient();
  const q = input.id
    ? supabase.from("cost_purchases").update(row).eq("id", input.id).select("id").single()
    : supabase.from("cost_purchases").insert(row).select("id").single();
  const { data, error } = await q;
  if (error) return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
  done();
  return { ok: true, id: data.id as string };
}

export async function deletePurchase(id: string): Promise<CResult> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("cost_purchases").delete().eq("id", id).select("photo_path").maybeSingle();
  if (error) return { ok: false, error: dbErr(error.message, "消せませんでした。") };
  await dropPhoto(data?.photo_path as string | null);
  done();
  return { ok: true };
}

/** 確認画面で「やめる」を押したとき、置いた写真を片付ける（どの行にも使われていないものだけ） */
export async function discardPhoto(path: string): Promise<CResult> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  if (!/^purchases\/\d{4}-\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path)) return { ok: false, error: "不正です。" };
  const supabase = await createClient();
  const { count } = await supabase.from("cost_purchases").select("id", { count: "exact", head: true }).eq("photo_path", path);
  if (!count) await dropPhoto(path);
  return { ok: true };
}

// ── ロス ─────────────────────────────────────────────────────

const REASONS: LossReason[] = ["expired", "overprep", "mistake", "damaged", "other"];

export async function addLoss(fd: FormData): Promise<CResult> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  const date = String(fd.get("date") ?? "");
  const item = String(fd.get("item") ?? "").trim();
  const amount = Number(fd.get("amount"));
  const reason = String(fd.get("reason") ?? "") as LossReason;
  const memo = String(fd.get("memo") ?? "").trim();
  if (!DATE_RE.test(date)) return { ok: false, error: "日付を入れてください。" };
  if (!item) return { ok: false, error: "何を捨てたかを入れてください。" };
  if (!Number.isInteger(amount) || amount < 0 || amount > 1_000_000) return { ok: false, error: "金額（仕入値の目安・円）を入れてください。" };
  if (!REASONS.includes(reason)) return { ok: false, error: "理由を選んでください。" };

  let photo: string | null = null;
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    const put = await putPhoto(file, `losses/${date.slice(0, 7)}`);
    if (!put.ok) return put;
    photo = put.path;
  }
  const supabase = await createClient();
  const { error } = await supabase.from("cost_losses").insert({
    biz_date: date,
    item: item.slice(0, 60),
    amount_ex: amount,
    reason,
    memo: memo.slice(0, 300) || null,
    photo_path: photo,
  });
  if (error) {
    await dropPhoto(photo);
    return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
  }
  done();
  return { ok: true };
}

export async function deleteLoss(id: string): Promise<CResult> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("cost_losses").delete().eq("id", id).select("photo_path").maybeSingle();
  if (error) return { ok: false, error: dbErr(error.message, "消せませんでした。") };
  await dropPhoto(data?.photo_path as string | null);
  done();
  return { ok: true };
}

// ── 棚卸 ─────────────────────────────────────────────────────

export type ItemInput = { id?: string; name: string; unit: string; unit_price: number; category: "food" | "drink"; active?: boolean };

export async function saveStockItem(input: ItemInput): Promise<CResult> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "品名を入れてください。" };
  if (!Number.isInteger(input.unit_price) || input.unit_price < 0 || input.unit_price > 1_000_000) {
    return { ok: false, error: "単価（税抜・円）を入れてください。" };
  }
  const row = {
    name: name.slice(0, 60),
    unit: (input.unit.trim() || "個").slice(0, 10),
    unit_price: input.unit_price,
    category: input.category === "drink" ? "drink" : "food",
    ...(input.active === undefined ? {} : { active: input.active }),
  };
  const supabase = await createClient();
  if (input.id) {
    const { error } = await supabase.from("cost_stock_items").update(row).eq("id", input.id);
    if (error) return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
    done();
    return { ok: true, id: input.id };
  }
  const { data: last } = await supabase.from("cost_stock_items").select("sort").order("sort", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabase
    .from("cost_stock_items")
    .insert({ ...row, sort: ((last?.sort as number | undefined) ?? 0) + 10 })
    .select("id")
    .single();
  if (error) return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
  done();
  return { ok: true, id: data.id as string };
}

/** 1品の数を入れる。null＝空欄に戻す（数えていない） */
export async function saveCount(ym: string, itemId: string, qty: number | null): Promise<CResult> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  if (!YM_RE.test(ym)) return { ok: false, error: "月が不正です。" };
  if (qty != null && (!Number.isFinite(qty) || qty < 0 || qty > 100_000)) return { ok: false, error: "数が不正です。" };
  const supabase = await createClient();
  const { data: st } = await supabase.from("cost_stocktakes").select("status").eq("ym", ym).maybeSingle();
  if (st?.status === "done") return { ok: false, error: "確定した棚卸は直せません。先に確定を外してください。" };
  if (!st) {
    const { error } = await supabase.from("cost_stocktakes").insert({ ym });
    if (error && error.code !== "23505") return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
  }
  if (qty == null) {
    const { error } = await supabase.from("cost_stock_counts").delete().eq("ym", ym).eq("item_id", itemId);
    if (error) return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
  } else {
    const { data: item } = await supabase.from("cost_stock_items").select("unit_price").eq("id", itemId).maybeSingle();
    if (!item) return { ok: false, error: "品目が見つかりません。" };
    const { error } = await supabase
      .from("cost_stock_counts")
      .upsert({ ym, item_id: itemId, qty: Math.round(qty * 100) / 100, unit_price: item.unit_price as number }, { onConflict: "ym,item_id" });
    if (error) return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
  }
  revalidatePath("/sales/cost/stock");
  return { ok: true };
}

/** 確定：数えた分の合計を、その月の在庫額として固定する */
export async function finishStocktake(ym: string): Promise<CResult> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  if (!YM_RE.test(ym)) return { ok: false, error: "月が不正です。" };
  const supabase = await createClient();
  const { data: counts, error } = await supabase.from("cost_stock_counts").select("qty, unit_price").eq("ym", ym);
  if (error) return { ok: false, error: dbErr(error.message, "確定できませんでした。") };
  if (!counts || counts.length === 0) return { ok: false, error: "まだ1品も数えていません。" };
  const total = stockTotal(counts.map((c) => ({ qty: Number(c.qty), unit_price: c.unit_price as number })));
  const { error: e2 } = await supabase
    .from("cost_stocktakes")
    .update({ status: "done", total_ex: total, done_at: new Date().toISOString(), done_by: (await requireProfile()).id })
    .eq("ym", ym);
  if (e2) return { ok: false, error: dbErr(e2.message, "確定できませんでした。") };
  done();
  return { ok: true };
}

export async function reopenStocktake(ym: string): Promise<CResult> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  if (!YM_RE.test(ym)) return { ok: false, error: "月が不正です。" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("cost_stocktakes")
    .update({ status: "draft", total_ex: null, done_at: null, done_by: null })
    .eq("ym", ym);
  if (error) return { ok: false, error: dbErr(error.message, "確定を外せませんでした。") };
  done();
  return { ok: true };
}
