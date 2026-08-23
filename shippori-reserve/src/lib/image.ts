/**
 * 選んだ写真を、送る前にブラウザ側で小さくする。
 *
 * スマホで撮った写真やスクリーンショットは数MBあり、そのまま送ると
 * 通信が詰まるうえ、サーバー側の受け入れ上限にも引っかかる。
 * チラシは「読めれば十分」なので、長辺1600pxのJPEGに縮めてから送る。
 *
 * 縮められない形式（PDFなど）や、うまくいかなかったときは元のまま返す——
 * ここで失敗しても、その後のサイズ検査が親切なメッセージで止めてくれる。
 */
export async function shrinkImage(file: File, maxEdge = 1600, quality = 0.85): Promise<File> {
  if (file.type === "application/pdf") return file;
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    // 縮まらなかった（すでに十分小さい）なら元のほうがきれい
    if (!blob || blob.size >= file.size) return file;

    const base = file.name.replace(/\.[^.]+$/, "") || "flyer";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** 「1.8MB」のように読める大きさにする */
export const fmtBytes = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
