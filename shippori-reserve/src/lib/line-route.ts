/*
 * 店の中向けLINE（しっぽり亭レポート）の「予約まわりの知らせ」を、だれに送るかを決める。
 * 純粋な関数だけ（node --test で回す）。実際に送るのは lib/line.ts の pushLineBooking。
 *
 * 決めごと（店主指定 2026-11-13）
 *  ・無料プランは月200通。数えられるのは「届いた人数ぶん」で、店長グループは6人なので、
 *    グループへ1回送ると6通減る（＝月33回で終わり）。2026年11月は予約の知らせだけで
 *    9日に使い切り、温度計の止まり・タイムカードの押し忘れが誰にも届かなくなった
 *  ・予約まわり（ネット予約・キャンセル・スタッフ入力・お客様メッセージの転送・クーポン配信）は
 *    店長個人あてに送る（1回1通）。グループへ送るのは、温度の異常と押し忘れのような
 *    「全員が知るべき知らせ」だけにして、そのぶんの通数を残す
 *  ・個人あてに送れるのは、その人が「しっぽり亭レポート」を友だち追加している間だけ。
 *    まだのときに黙って捨てない——今までどおりグループへ送り、友だち追加を促す一文を添える
 *    （届かない理由に誰も気づけない仕組みにしない）
 *  ・本人が自分で入力した予約は、本人に知らせない（もう知っているので、通数だけ減る）
 */

/** settings のキー。値は { line_user_id, profile_id, name } */
export const BOOKING_TARGET_KEY = "line_booking_notify";

export type BookingTarget = {
  /** しっぽり亭レポートから見た、その人のLINEのID（U＋32桁） */
  lineUserId: string;
  /** その人のアプリのアカウント（本人が入力した予約を見分けるため）。分からなければ null */
  profileId: string | null;
  /** 促す一文に出す呼び名 */
  name: string;
};

export type BookingRoute =
  | { to: "person"; lineUserId: string }
  | { to: "group"; nudge: string | null }
  | { to: "none" };

const LINE_USER_ID = /^U[0-9a-f]{32}$/;

/** settings の値を読む。形が違えば null（＝未設定として、今までどおりグループへ送る） */
export function parseBookingTarget(value: unknown): BookingTarget | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const lineUserId = typeof v.line_user_id === "string" ? v.line_user_id.trim() : "";
  if (!LINE_USER_ID.test(lineUserId)) return null;
  const profileId = typeof v.profile_id === "string" && v.profile_id.trim() ? v.profile_id.trim() : null;
  const name = typeof v.name === "string" && v.name.trim() ? v.name.trim().slice(0, 20) : "店長";
  return { lineUserId, profileId, name };
}

/**
 * どこへ送るか。
 * isFriend: その人が「しっぽり亭レポート」を友だち追加しているか。調べられなかったら null。
 *   null は個人あてに倒す——LINEの調子が悪い一瞬のために、6通使うグループあてへ戻さない。
 * actorProfileId: この知らせのもとになった操作をした人（スタッフ入力の予約なら入力した人）。
 */
export function bookingRoute(
  target: BookingTarget | null,
  opts: { isFriend: boolean | null; actorProfileId?: string | null },
): BookingRoute {
  if (!target) return { to: "group", nudge: null };
  if (target.profileId && opts.actorProfileId === target.profileId) return { to: "none" };
  if (opts.isFriend === false) {
    return {
      to: "group",
      nudge: `※ ${target.name}さんが「しっぽり亭レポート」を友だち追加すると、このお知らせは${target.name}さん個人あてに切り替わります（グループあては1回で人数ぶんの通数を使います）。`,
    };
  }
  return { to: "person", lineUserId: target.lineUserId };
}
