"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { can } from "@/lib/constants";
import { todayBizDate } from "@/lib/time";
import { asOfFor, PDF_MAX, stockTotal, type DocKind, type LossReason, type StockTiming } from "@/lib/cost";
import { issueApiToken } from "@/lib/api-token";
import { COST_BUCKET } from "@/lib/cost-data";

/*
 * 原価の書き込み。権限はここで見たうえで、DB でも RLS がもう一度見る。
 * 写真は非公開の置き場へサーバー（管理キー）が置く。
 */

export type CResult = { ok: true; id?: string } | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
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

/**
 * 写真を撮るだけ（店長・毎日）。読み取り待ちの行を作り、読むのは毎朝の定期実行（サブスクのClaude）。
 * API料金は使わない（店主指示 2026-11-06）。過去の書類をまとめて入れるときは複数枚を一度に送れる。
 */
export async function addPurchasePhotos(fd: FormData): Promise<CResult & { added?: number }> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  const files = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { ok: false, error: "写真を選んでください。" };
  if (files.length > 20) return { ok: false, error: "一度に送れるのは20枚までです。" };
  const today = todayBizDate();
  const supabase = await createClient();
  let added = 0;
  for (const file of files) {
    const put = await putPhoto(file, `purchases/${today.slice(0, 7)}`);
    if (!put.ok) return { ok: false, error: added ? `${added}枚は保存しました。残りで止まりました：${put.error}` : put.error };
    const { error } = await supabase
      .from("cost_purchases")
      .insert({ status: "pending", book_date: today, doc_kind: "receipt", vendor: null, photo_path: put.path });
    if (error) {
      await dropPhoto(put.path);
      return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
    }
    added += 1;
  }
  done();
  return { ok: true, added };
}

/**
 * スキャンしたPDF（初回の請求書の束など）。大きいのでブラウザから置き場へ直接送る
 * （Vercel はサーバーに送れる量が4.5MBまで）。ここでは送り先の一時的な許可だけ作る。
 */
export async function pdfUploadTicket(size: number): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "PDFを選んでください。" };
  if (size > PDF_MAX) return { ok: false, error: "PDFは1つ20MBまでです。分けてスキャンしてください。" };
  const path = `purchases/${todayBizDate().slice(0, 7)}/${crypto.randomUUID()}.pdf`;
  const { data, error } = await createAdminClient().storage.from(COST_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[cost] pdf ticket", error?.message);
    return { ok: false, error: "送る準備ができませんでした。" };
  }
  return { ok: true, path, token: data.token };
}

const PDF_PATH_RE = /^purchases\/\d{4}-\d{2}\/[0-9a-f-]{36}\.pdf$/;

/** 置き場に送り終わったPDFを、読み取り待ちとして並べる。1つのPDFに書類が何枚あってもよい（読み取り役が分ける） */
export async function addPurchasePdf(path: string): Promise<CResult> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  if (!PDF_PATH_RE.test(path)) return { ok: false, error: "PDFの置き場所が不正です。" };
  const { error: e1 } = await createAdminClient().storage.from(COST_BUCKET).createSignedUrl(path, 60);
  if (e1) return { ok: false, error: "PDFが届いていません。もう一度送ってください。" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("cost_purchases")
    .insert({ status: "pending", book_date: todayBizDate(), doc_kind: "invoice", vendor: null, photo_path: path });
  if (error) {
    await dropPhoto(path);
    return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
  }
  done();
  return { ok: true };
}

/** 読み取った内容を写真と見比べて、合っていたら「確認した」 */
export async function confirmPurchase(id: string): Promise<CResult> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  const supabase = await createClient();
  const { error } = await supabase.from("cost_purchases").update({ status: "confirmed" }).eq("id", id).eq("status", "unconfirmed");
  if (error) return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
  done();
  return { ok: true };
}

/** 読み取り口の合言葉を発行（オーナーだけ）。平文はこの1回しか出ない。発行し直すと前のは効かなくなる */
export async function issueReaderToken(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const me = await requireProfile();
  if (me.role !== "owner") return { ok: false, error: "発行できるのはオーナーだけです。" };
  try {
    return { ok: true, token: await issueApiToken("cost_reader", me.id) };
  } catch {
    return { ok: false, error: "発行できませんでした。" };
  }
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
    // 人が見て保存した＝確認済み（読み取り待ち・未確認の行を直したときもここに来る）
    status: "confirmed",
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
  // 1つのPDFから何件も書類を読んだときは、同じファイルを他の行も使っている。最後の1件のときだけ消す
  const path = data?.photo_path as string | null;
  if (path) {
    const { count } = await createAdminClient().from("cost_purchases").select("id", { count: "exact", head: true }).eq("photo_path", path);
    if (!count) await dropPhoto(path);
  }
  done();
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

/**
 * 捨てたものを撮るだけ（店長・毎日。グループLINEに上げていた写真の代わり・店主指示 2026-11-09）。
 * 読み取り待ちの行を作り、品名・金額の目安は毎朝の読み取り役（サブスクのClaude）が入れる。ひとことは全部の写真に付く。
 */
export async function addLossPhotos(fd: FormData): Promise<CResult & { added?: number }> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  const files = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { ok: false, error: "写真を選んでください。" };
  if (files.length > 10) return { ok: false, error: "一度に送れるのは10枚までです。" };
  const memo = String(fd.get("memo") ?? "").trim().slice(0, 300) || null;
  const today = todayBizDate();
  const supabase = await createClient();
  let added = 0;
  for (const file of files) {
    const put = await putPhoto(file, `losses/${today.slice(0, 7)}`);
    if (!put.ok) return { ok: false, error: added ? `${added}枚は保存しました。残りで止まりました：${put.error}` : put.error };
    const { error } = await supabase.from("cost_losses").insert({ status: "pending", biz_date: today, memo, photo_path: put.path });
    if (error) {
      await dropPhoto(put.path);
      return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
    }
    added += 1;
  }
  done();
  return { ok: true, added };
}

/** ロスの見積もりを写真と見比べて、合っていたら「確認した」 */
export async function confirmLoss(id: string): Promise<CResult> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  const supabase = await createClient();
  const { error } = await supabase.from("cost_losses").update({ status: "confirmed" }).eq("id", id).eq("status", "unconfirmed");
  if (error) return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
  done();
  return { ok: true };
}

/** ロスを直す（読み取り待ち・未確認の行に人が入れる）。直したら確認済み */
export async function updateLoss(input: { id: string; item: string; amount_ex: number; reason: LossReason; memo: string }): Promise<CResult> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  const item = input.item.trim();
  if (!item) return { ok: false, error: "何を捨てたかを入れてください。" };
  if (!Number.isInteger(input.amount_ex) || input.amount_ex < 0 || input.amount_ex > 1_000_000) return { ok: false, error: "金額（仕入値の目安・円）を入れてください。" };
  if (!REASONS.includes(input.reason)) return { ok: false, error: "理由を選んでください。" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("cost_losses")
    .update({ item: item.slice(0, 60), amount_ex: input.amount_ex, reason: input.reason, memo: input.memo.trim().slice(0, 300) || null, status: "confirmed" })
    .eq("id", input.id);
  if (error) return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
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

/**
 * 棚卸を始める（基本は毎週日曜の営業中）。数えた日といつ数えたかから「どの営業日の終わりまでの在庫か」を決める。
 * 同じ区切りの棚卸がすでにあれば、それを開く。
 */
export async function startStocktake(countedOn: string, timing: StockTiming): Promise<CResult & { asOf?: string }> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  if (!DATE_RE.test(countedOn)) return { ok: false, error: "数えた日を入れてください。" };
  if (timing !== "before_open" && timing !== "during" && timing !== "after_close") return { ok: false, error: "いつ数えるかを選んでください。" };
  if (countedOn > todayBizDate()) return { ok: false, error: "先の日付では始められません。" };
  const asOf = asOfFor(countedOn, timing);
  const supabase = await createClient();
  const { data: have } = await supabase.from("cost_stocktakes").select("as_of").eq("as_of", asOf).maybeSingle();
  if (!have) {
    const { error } = await supabase.from("cost_stocktakes").insert({ as_of: asOf, counted_on: countedOn, timing });
    if (error && error.code !== "23505") return { ok: false, error: dbErr(error.message, "始められませんでした。") };
  }
  done();
  return { ok: true, asOf };
}

/** 下書きの棚卸を消す（日付やタイミングを間違えたとき）。確定したものは DB が消させない */
export async function deleteStocktake(asOf: string): Promise<CResult> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  if (!DATE_RE.test(asOf)) return { ok: false, error: "日付が不正です。" };
  const supabase = await createClient();
  const { error } = await supabase.from("cost_stocktakes").delete().eq("as_of", asOf);
  if (error) return { ok: false, error: dbErr(error.message, "消せませんでした。") };
  done();
  return { ok: true };
}

/** 1品の数を入れる。null＝空欄に戻す（数えていない） */
export async function saveCount(asOf: string, itemId: string, qty: number | null): Promise<CResult> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  if (!DATE_RE.test(asOf)) return { ok: false, error: "日付が不正です。" };
  if (qty != null && (!Number.isFinite(qty) || qty < 0 || qty > 100_000)) return { ok: false, error: "数が不正です。" };
  const supabase = await createClient();
  const { data: st } = await supabase.from("cost_stocktakes").select("status").eq("as_of", asOf).maybeSingle();
  if (!st) return { ok: false, error: "棚卸が見つかりません。もう一度開き直してください。" };
  if (st.status === "done") return { ok: false, error: "確定した棚卸は直せません。先に確定を外してください。" };
  if (qty == null) {
    const { error } = await supabase.from("cost_stock_counts").delete().eq("as_of", asOf).eq("item_id", itemId);
    if (error) return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
  } else {
    const { data: item } = await supabase.from("cost_stock_items").select("unit_price").eq("id", itemId).maybeSingle();
    if (!item) return { ok: false, error: "品目が見つかりません。" };
    const { error } = await supabase
      .from("cost_stock_counts")
      .upsert({ as_of: asOf, item_id: itemId, qty: Math.round(qty * 100) / 100, unit_price: item.unit_price as number }, { onConflict: "as_of,item_id" });
    if (error) return { ok: false, error: dbErr(error.message, "保存できませんでした。") };
  }
  revalidatePath("/sales/cost/stock");
  return { ok: true };
}

/** 確定：数えた分の合計を、その日の在庫額として固定する */
export async function finishStocktake(asOf: string): Promise<CResult> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  if (!DATE_RE.test(asOf)) return { ok: false, error: "日付が不正です。" };
  const supabase = await createClient();
  const { data: counts, error } = await supabase.from("cost_stock_counts").select("qty, unit_price").eq("as_of", asOf);
  if (error) return { ok: false, error: dbErr(error.message, "確定できませんでした。") };
  if (!counts || counts.length === 0) return { ok: false, error: "まだ1品も数えていません。" };
  const total = stockTotal(counts.map((c) => ({ qty: Number(c.qty), unit_price: c.unit_price as number })));
  const { error: e2 } = await supabase
    .from("cost_stocktakes")
    .update({ status: "done", total_ex: total, done_at: new Date().toISOString(), done_by: (await requireProfile()).id })
    .eq("as_of", asOf);
  if (e2) return { ok: false, error: dbErr(e2.message, "確定できませんでした。") };
  done();
  return { ok: true };
}

export async function reopenStocktake(asOf: string): Promise<CResult> {
  if (!(await canWrite())) return { ok: false, error: "権限がありません。" };
  if (!DATE_RE.test(asOf)) return { ok: false, error: "日付が不正です。" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("cost_stocktakes")
    .update({ status: "draft", total_ex: null, done_at: null, done_by: null })
    .eq("as_of", asOf);
  if (error) return { ok: false, error: dbErr(error.message, "確定を外せませんでした。") };
  done();
  return { ok: true };
}
