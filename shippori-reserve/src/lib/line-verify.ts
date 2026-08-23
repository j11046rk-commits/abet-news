/*
 * LINEからの通知が本物かを確かめる、鍵を持たない部分。
 *
 * 合言葉（チャネルシークレット）は**引数で受け取る**。環境変数をここで読まないので、
 * このファイルはそのまま試験できる（`server-only` を付けたモジュールはテストから読めない）。
 * 環境変数を読むのは line-login.ts の役目。鍵の出所と、鍵の使い方を分けてある。
 */

/** LINEのユーザーIDの形。U＋16進32文字（LINEの仕様） */
export const LINE_USER_ID_RE = /^U[0-9a-f]{32}$/;

/**
 * webhookの署名を確かめる。
 *
 * ★比較は「時間のかかり方が中身で変わらない」方法で行う。
 *   1文字ずつ見て違ったらすぐ抜ける書き方だと、応答の速さの違いから
 *   正解の署名を1文字ずつ探り当てられる。
 */
export async function signatureMatches(
  body: string,
  signature: string | null | undefined,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret || !signature) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = Buffer.from(new Uint8Array(mac)).toString("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
