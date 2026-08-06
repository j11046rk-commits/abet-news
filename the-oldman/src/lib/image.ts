"use client";

/**
 * 送る前に写真を小さくする。
 *
 * スマホの写真は 4032×3024 / 3〜4MB がふつうで、そのまま送ると電波の細い場所では
 * 何十秒もかかる。リストのサムネイルは実寸で56px、拡大しても画面の幅ぶんあれば
 * 足りるので、長辺1280pxまで縮めて詰め直す。3.3MB → 280KB 前後になる。
 *
 * JPEG で詰める。理由が2つある。
 *
 *  1) WebP はエンコードが遅い。手元の計測で 1280px / 同じくらいの容量に対して
 *     JPEG 47ms に対し WebP 200ms。端末が非力なほど差が開く。
 *  2) iOS 17 より前の Safari は canvas から WebP を書き出せない。しかも失敗せず、
 *     黙って PNG を返す。PNG は写真だと元より大きくなるので、
 *     「縮まなかったから元のまま送る」という分岐に落ちて、結局3MBを送っていた。
 *
 * 出てきた MIME が頼んだものと違う場合は、その時点で諦めて元のファイルを返す。
 */
const MAX_EDGE = 1280;
const QUALITY = 0.75;
const TYPE = "image/jpeg";

export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  try {
    // iPhone の縦位置の写真は EXIF に回転が入っている。
    // これを指定しないと、横倒しのまま焼き込まれる。
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

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
      canvas.toBlob(resolve, TYPE, QUALITY),
    );

    // 頼んだ形式で出てこなかった（＝この端末では詰め直せない）
    if (!blob || blob.type !== TYPE) return file;
    // すでに小さい画像を再圧縮して汚すだけになる場合は元のまま
    if (blob.size >= file.size) return file;

    return new File([blob], "image.jpg", { type: TYPE });
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
