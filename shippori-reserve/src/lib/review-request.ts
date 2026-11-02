/*
 * 来店後の口コミのお願い：誰に送るかの判定（店主要望 2026-11-02）。
 *
 * ★送るのは「会計済」（completed）と「来店中」（seated）の予約だけ。
 *   どちらも席ボードで実際に座ったときにだけ付く状態なので、
 *   キャンセル・無断キャンセル・来店の記録が無い予約（confirmed のまま）には送らない
 *   （店主指示：予約したけど結局キャンセルした人に送らないこと）。
 *   来店中を含めるのは、帰りの記録が翌日の席ボード操作まで「来店中」のまま残るため
 *   （翌朝11時の時点では会計済になっていないことがある）。
 * ★同じ人には REVIEW_COOLDOWN_DAYS のあいだ送らない（常連さんに毎回届かないように）。
 * ★LINEをブロックした人（友だち解除）には送らない。
 * ★特典は付けない（Googleのルールで、見返りつきの口コミ依頼は禁止）。
 *
 * このファイルは値のimportを持たない（node --test で直に回せるようにするため）。
 */

export const REVIEW_COOLDOWN_DAYS = 180;

export type ReviewCandidate = {
  id: string;
  status: string;
  line_user_id: string | null;
};

/**
 * 送る相手を決める。1人1通（同じ日に2件の予約があっても1回だけ）。
 * recentlySent: 直近 REVIEW_COOLDOWN_DAYS 日に送った LINE ユーザー
 * unfollowed: 友だち解除している LINE ユーザー
 */
export function pickReviewTargets(
  rows: ReviewCandidate[],
  recentlySent: Set<string>,
  unfollowed: Set<string>,
): { lineUserId: string; reservationId: string }[] {
  const out = new Map<string, string>();
  for (const r of rows) {
    if (r.status !== "completed" && r.status !== "seated") continue;
    const uid = r.line_user_id?.trim();
    if (!uid || recentlySent.has(uid) || unfollowed.has(uid) || out.has(uid)) continue;
    out.set(uid, r.id);
  }
  return [...out].map(([lineUserId, reservationId]) => ({ lineUserId, reservationId }));
}

/** Googleの口コミ用リンクらしいか（設定の打ち間違いで別のURLを送らないため） */
export const isReviewUrl = (u: unknown): u is string =>
  typeof u === "string" &&
  /^https:\/\/(g\.page\/r\/|search\.google\.com\/local\/writereview|maps\.app\.goo\.gl\/|g\.co\/kgs\/)/.test(u.trim());

export const reviewMessage = (url: string): string =>
  [
    "昨日はしっぽり亭にご来店いただき、ありがとうございました🍺",
    "",
    "もしよろしければ、Googleマップにご感想をいただけるととても励みになります。",
    "ひと言だけでも大歓迎です。",
    url,
    "",
    "またのご来店を、スタッフ一同お待ちしております。",
  ].join("\n");
