"use client";

/**
 * 送る前に写真を小さくする。
 *
 * スマホの写真は 4032×3024 / 3〜4MB がふつうで、そのまま送ると
 * 電波の細い場所では何十秒もかかる。リストのサムネイルは実寸で56pxしかなく、
 * 拡大して見るときでも画面の幅ぶんあれば足りるので、長辺1600pxまで縮めて
 * WebP に詰め直す。だいたい 3.5MB → 150KB 前後になる。
 *
 * 変換できない形式（Safari以外のHEICなど）や、縮めても小さくならない画像は
 * 元のまま返す。ここで失敗しても保存そのものは続けられるようにしておく。
 */
const MAX_EDGE = 1600;
const QUALITY = 0.82;

export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", QUALITY),
    );

    // 縮まなかったなら元のほうがよい（すでに小さい画像を再圧縮して汚すだけになる）
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], "image.webp", { type: "image/webp" });
  } catch {
    return file;
  }
}

/** 拡張子。バケットに置くときのファイル名に使う。 */
export function extOf(type: string): string {
  if (type === "image/webp") return "webp";
  if (type === "image/png") return "png";
  if (type === "image/heic") return "heic";
  return "jpg";
}
