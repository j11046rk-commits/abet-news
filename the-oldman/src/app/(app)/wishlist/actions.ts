"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: true } | { ok: false; error: string };

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

/**
 * ほしい物を1件追加する。画像は任意。
 *
 * FormData で受けるのは、画像をサーバ側で検証してから置きたいため。
 * ブラウザから直接バケットへ上げると、拡張子と中身が食い違っていても通ってしまう。
 */
export async function createWishlistItem(form: FormData): Promise<Result> {
  const me = await requireProfile();

  const title = String(form.get("title") ?? "").trim();
  const note = String(form.get("note") ?? "").trim();
  const raw = String(form.get("amount") ?? "").replace(/[^\d]/g, "");
  const amount = raw ? Number(raw) : null;

  if (!title) return { ok: false, error: "名称を入力してください。" };
  if (amount !== null && !Number.isSafeInteger(amount))
    return { ok: false, error: "金額を確認してください。" };

  const supabase = await createClient();

  let imagePath: string | null = null;
  const file = form.get("image");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return { ok: false, error: "画像は5MBまでです。" };
    if (!TYPES.has(file.type)) return { ok: false, error: "画像はJPEG・PNG・WebPで。" };

    // 誰のものか分かるようにフォルダを切る。名前は衝突しないものを付ける。
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${me.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("wishlist")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) return { ok: false, error: "画像を保存できませんでした。" };
    imagePath = path;
  }

  const { error } = await supabase.from("wishlist_items").insert({
    title,
    amount_yen: amount,
    note: note || null,
    image_path: imagePath,
    created_by: me.id,
  });

  if (error) {
    // 行が作れなかったのに画像だけ残ると、誰からも辿れないゴミになる。
    if (imagePath) await supabase.storage.from("wishlist").remove([imagePath]);
    return { ok: false, error: "保存できませんでした。" };
  }

  revalidatePath("/wishlist");
  return { ok: true };
}

/** 買ったら閉じる。行は残す（何をいくらで買ったかの記録として）。 */
export async function setWishlistBought(id: string, bought: boolean): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase
    .from("wishlist_items")
    .update({ bought_at: bought ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { ok: false, error: "更新できませんでした。" };
  revalidatePath("/wishlist");
  return { ok: true };
}

export async function deleteWishlistItem(id: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();

  const { data } = await supabase
    .from("wishlist_items")
    .select("image_path")
    .eq("id", id)
    .maybeSingle<{ image_path: string | null }>();

  const { error } = await supabase.from("wishlist_items").delete().eq("id", id);
  if (error) return { ok: false, error: "削除できませんでした。" };

  if (data?.image_path) await supabase.storage.from("wishlist").remove([data.image_path]);

  revalidatePath("/wishlist");
  return { ok: true };
}
