import "server-only";
import { LINE_USER_ID_RE, signatureMatches } from "@/lib/line-verify";

/**
 * LINEログイン（LIFF）で受け取った身分証を、LINEに問い合わせて確かめる。
 *
 * ★ブラウザから送られてきたユーザーIDを、そのまま信じてはいけない。
 *   `liff.getProfile()` の結果をそのまま送らせる作りにすると、
 *   誰でも他人のIDを名乗れる——他人になりすまして予約を入れたり、
 *   他人の予約をキャンセルしたりできてしまう。
 *
 *   だから受け取るのは**IDトークン**（LINEが署名した身分証）だけにして、
 *   それをLINE自身に検証してもらい、返ってきた `sub` をユーザーIDとして使う。
 *   ここを通っていないIDは、どこにも保存しない。
 *
 * 検証は LINE の /oauth2/v2.1/verify に投げる。自前で署名検証もできるが、
 * 鍵の入れ替えを自分で追う必要が出る。1回のHTTPで済むほうが、
 * 店の規模では確実（予約1件につき1回しか呼ばない）。
 */

export { LINE_USER_ID_RE };

export type LineIdentity = {
  /** LINEのユーザーID（U で始まる33文字）。これが本人の印 */
  userId: string;
  /** LINEに登録された表示名。予約者名の下書きに使う（お客様は直せる） */
  displayName: string | null;
};

/** LINEログインが設定されているか。未設定なら、そもそもLIFFの導線を出さない */
export function lineLoginEnabled(): boolean {
  return !!process.env.LINE_LOGIN_CHANNEL_ID && !!process.env.NEXT_PUBLIC_LIFF_ID;
}

type VerifyResponse = {
  sub?: string;
  name?: string;
  aud?: string;
  error?: string;
  error_description?: string;
};

/**
 * IDトークンを検証して、本人のユーザーIDを取り出す。
 * 検証できなければ null（＝LINEと結びつけずに、ふつうの予約として通す）。
 *
 * ここで例外を投げないのは、**LINEが落ちていても予約は通ってほしい**から。
 * 結びつきは「あると嬉しいもの」で、予約そのものを止める理由にはならない。
 */
export async function verifyLineIdToken(idToken: string | undefined | null): Promise<LineIdentity | null> {
  const token = (idToken ?? "").trim();
  const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!token || !clientId) return null;
  // 形だけでも見ておく（JWTは3つの部分を . でつないだもの）
  if (token.split(".").length !== 3 || token.length > 4000) return null;

  try {
    const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: token, client_id: clientId }),
      // LINEが遅いときに予約全体を待たせない
      signal: AbortSignal.timeout(4000),
    });
    const body = (await res.json().catch(() => null)) as VerifyResponse | null;
    if (!res.ok || !body || body.error) {
      console.error("line_verify_failed", res.status, body?.error, body?.error_description);
      return null;
    }
    // aud（宛先）が自分のチャネルであることは LINE 側でも見ているが、念のため自分でも見る
    if (body.aud && body.aud !== clientId) {
      console.error("line_verify_aud_mismatch");
      return null;
    }
    const userId = (body.sub ?? "").trim();
    if (!LINE_USER_ID_RE.test(userId)) return null;

    const name = (body.name ?? "").trim();
    return { userId, displayName: name === "" ? null : name };
  } catch (e) {
    console.error("line_verify_error", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Webhookが本当にLINEから来たかを確かめる。
 *
 * この口は誰でも叩けるURLなので、確かめないと
 * 「知らない人が友だち追加された・ブロックされた」と偽の記録を入れられる。
 * 名簿が汚れると、送ってはいけない相手に送る事故につながる。
 *
 * 確かめ方そのものは line-verify.ts（鍵を持たない・試験できる）。ここは鍵を渡すだけ。
 */
export async function verifyLineSignature(body: string, signature: string | null): Promise<boolean> {
  return signatureMatches(body, signature, process.env.LINE_CHANNEL_SECRET);
}
