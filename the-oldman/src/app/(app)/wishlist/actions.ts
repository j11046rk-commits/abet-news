"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: true } | { ok: false; error: string };

/**
 * 画像の実体はブラウザから直接バケットへ上げる。ここへ来るのはその置き場所だけ。
 *
 * かつては File を Server Action に渡して、サーバ経由でバケットへ入れていた。
 * それだと (1) Server Action の本文上限 1MB に引っかかって写真が保存できず、
 * (2) 通っても スマホ→Vercel→Supabase と同じバイト列を2回運ぶことになる。
 *
 * 自分のフォルダ以外のパスは受け付けない。他人が上げた画像を
 * 自分の行に紐づけられないようにするため。
 */
const PATH_RE = /^[0-9a-f-]{36}\/[0-9a-zA-Z_-]{1,64}\.(webp|jpg|jpeg|png|heic)$/;

export async function createWishlistItem(input: {
  title: string;
  amountYen: number | null;
  note: string;
  imagePath: string | null;
}): Promise<Result> {
  const me = await requireProfile();

  const title = input.title.trim();
  if (!title) return { ok: false, error: "名称を入力してください。" };
  if (input.amountYen !== null && !Number.isSafeInteger(input.amountYen))
    return { ok: false, error: "金額を確認してください。" };

  if (input.imagePath !== null) {
    if (!PATH_RE.test(input.imagePath) || !input.imagePath.startsWith(`${me.id}/`))
      return { ok: false, error: "画像を保存できませんでした。" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("wishlist_items").insert({
    title,
    amount_yen: input.amountYen,
    note: input.note.trim() || null,
    image_path: input.imagePath,
    created_by: me.id,
  });

  if (error) return { ok: false, error: "保存できませんでした。" };

  revalidatePath("/wishlist");
  return { ok: true };
}

/**
 * 書いたあとの直し。
 *
 * 直せるのは自分が挙げたものだけ。購入済みのチェックは誰でも触れる（気づいた人が
 * 閉じられるように）が、名称や金額は挙げた本人の言い分なので、本人以外は変えない。
 *
 * image は3通り: undefined = そのまま、null = 外す、文字列 = 差し替え。
 */
export async function updateWishlistItem(
  id: string,
  input: {
    title: string;
    amountYen: number | null;
    note: string;
    imagePath?: string | null;
  },
): Promise<Result> {
  const me = await requireProfile();

  const title = input.title.trim();
  if (!title) return { ok: false, error: "名称を入力してください。" };
  if (input.amountYen !== null && !Number.isSafeInteger(input.amountYen))
    return { ok: false, error: "金額を確認してください。" };

  if (typeof input.imagePath === "string") {
    if (!PATH_RE.test(input.imagePath) || !input.imagePath.startsWith(`${me.id}/`))
      return { ok: false, error: "画像を保存できませんでした。" };
  }

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("wishlist_items")
    .select("created_by, image_path")
    .eq("id", id)
    .maybeSingle<{ created_by: string; image_path: string | null }>();

  if (!row) return { ok: false, error: "見つかりませんでした。" };
  if (row.created_by !== me.id) return { ok: false, error: "自分が挙げたものだけ直せます。" };

  const { error } = await supabase
    .from("wishlist_items")
    .update({
      title,
      amount_yen: input.amountYen,
      note: input.note.trim() || null,
      ...(input.imagePath === undefined ? {} : { image_path: input.imagePath }),
    })
    .eq("id", id);

  if (error) return { ok: false, error: "更新できませんでした。" };

  // 差し替え・取り外しで浮いた画像は消す。残しても誰からも辿れない。
  if (input.imagePath !== undefined && row.image_path && row.image_path !== input.imagePath) {
    await supabase.storage.from("wishlist").remove([row.image_path]);
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
