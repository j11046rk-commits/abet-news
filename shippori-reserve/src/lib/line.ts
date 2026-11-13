import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { BOOKING_TARGET_KEY, bookingRoute, parseBookingTarget, type BookingTarget } from "@/lib/line-route";

/*
 * LINEへの通知。
 *
 * ★公式アカウントは2つある。取り違えると届かない。
 *
 *   ① しっぽり亭レポート            … 店の中向け。週次レポートと同じグループ。
 *                                     LINE_CHANNEL_ACCESS_TOKEN / LINE_TARGET_ID
 *   ② しっぽり亭 家庭料理おばんざい居酒屋 … お客様向け。友だち追加してもらうのはこちら。
 *                                     LINE_CUSTOMER_CHANNEL_ACCESS_TOKEN
 *
 *   お客様は②の友だちなので、①のトークンで送っても届かない（友だちでない相手には送れない）。
 *   逆に②から店のグループへ送ることもできない。**送り先ではなく、どのアカウントから
 *   送るかで決まる**ので、トークンを共有せずに分けてある。
 *
 * LINE Notify は2025年3月に終了しているので、公式アカウントの
 * チャンネルアクセストークンで push する。
 *
 * ★通知は「おまけ」で、予約より重くしない。
 *   送信に失敗しても、遅くても、予約そのものは必ず成立させる。
 *   LINE が落ちている日にネット予約が取れなくなるのは本末転倒なので、
 *   失敗は記録するだけで握りつぶし、待ち時間にも上限を置く。
 *
 * ★送る中身は最小限にする。
 *   電話番号は送らない。姓だけにする。
 *   「予約が入った」と気づくのに必要なのは日時・人数・席で、
 *   連絡先が要るのは実際に電話をかけるときだけ——それはアプリの中にある。
 *   LINEのトーク履歴は端末にもクラウドにも残り、こちらでは消せない。
 *
 * ★①は無料の月200通。数えられるのは「届いた人数ぶん」。
 *   店長グループ（6人）へ1回送ると6通減るので、グループあては月33回で終わる。
 *   2026年11月は予約の知らせだけで9日に使い切り、温度計の止まりと押し忘れが届かなくなった。
 *   だから送り先を2つに分けてある（店主指定 2026-11-13）。
 *     pushLine        … グループ全員へ。温度の異常・押し忘れなど、全員が知るべきものだけ
 *     pushLineBooking … 店長個人へ（1回1通）。予約まわりの知らせはこちら
 */

const PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";
/** LINEが遅くても、お客様の予約確定を待たせない */
const TIMEOUT_MS = 3000;
/** 友だちかどうかの確認は、送信そのものより短く切る（分からなければ個人あてに倒す） */
const FRIEND_CHECK_TIMEOUT_MS = 1500;

/**
 * グループへ1通送る（店のスタッフ向け）。**1回で人数ぶんの通数を使う。**
 * 予約まわりの知らせには使わない（pushLineBooking を使う）。
 * 設定が無ければ黙って何もしない（開発環境・未設定でも壊れない）。
 * 返り値は送れたかどうか。呼ぶ側はこれを見て分岐しないこと——通知は結果に影響させない。
 */
export async function pushLine(text: string): Promise<boolean> {
  return pushTo(process.env.LINE_CHANNEL_ACCESS_TOKEN, process.env.LINE_TARGET_ID, text);
}

/**
 * 予約まわりの知らせを送る（ネット予約・キャンセル・スタッフ入力・お客様メッセージの転送・クーポン配信）。
 *
 * 送り先は settings の line_booking_notify（店長個人）。決め方は lib/line-route.ts。
 *   ・店長が「しっぽり亭レポート」を友だち追加している … 店長個人へ1通
 *   ・まだ追加していない … 今までどおりグループへ送り、追加を促す一文を添える
 *   ・設定が無い … 今までどおりグループへ
 *   ・actorProfileId が店長本人 … 送らない（本人が入力した予約）
 *
 * 返り値は送れたかどうか。pushLine と同じく、呼ぶ側はこれで分岐しないこと。
 */
export async function pushLineBooking(
  text: string,
  opts: { actorProfileId?: string | null } = {},
): Promise<boolean> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return false;

  const target = await bookingTarget();
  // 本人の入力ぶんは友だち確認の前に落とす（LINEへの問い合わせを1回減らす）
  const self = Boolean(target?.profileId) && opts.actorProfileId === target?.profileId;
  const isFriend = target && !self ? await isStoreFriend(token, target.lineUserId) : null;
  const route = bookingRoute(target, { isFriend, actorProfileId: opts.actorProfileId });

  if (route.to === "none") return false;
  if (route.to === "person") return pushTo(token, route.lineUserId, text);
  return pushTo(token, process.env.LINE_TARGET_ID, route.nudge ? `${text}\n\n${route.nudge}` : text);
}

/** 予約まわりの知らせの送り先。読めなければ null（＝今までどおりグループへ） */
async function bookingTarget(): Promise<BookingTarget | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("settings").select("value").eq("key", BOOKING_TARGET_KEY).maybeSingle();
    return parseBookingTarget(data?.value);
  } catch (e) {
    console.error("line_booking_target_error", e instanceof Error ? e.name : "unknown");
    return null;
  }
}

/**
 * その人が「しっぽり亭レポート」を友だち追加しているか。分からなければ null。
 * LINEは、友だちでない人（とブロックした人）のプロフィールに 404 を返す。
 * 個人あての push は友だちにしか届かないので、送る前にここで見分ける。
 */
async function isStoreFriend(token: string, lineUserId: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${lineUserId}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FRIEND_CHECK_TIMEOUT_MS),
    });
    if (res.ok) return true;
    if (res.status === 404) return false;
    console.error("line_friend_check_failed", res.status);
    return null;
  } catch (e) {
    console.error("line_friend_check_error", e instanceof Error ? e.name : "unknown");
    return null;
  }
}

/**
 * お客様ご本人へ1通送る（LIFFで予約したお客様だけ）。
 *
 * ★お客様向けアカウント（家庭料理おばんざい居酒屋）から送る。
 *   店のレポート用アカウントで送っても、お客様はその友だちではないので届かない。
 *
 * ★文面には、席や他のお客様のことを書かない。ご本人のご予約の内容だけにする。
 */
export async function pushLineUser(lineUserId: string | null | undefined, text: string): Promise<boolean> {
  return pushTo(process.env.LINE_CUSTOMER_CHANNEL_ACCESS_TOKEN, lineUserId, text);
}

async function pushTo(
  token: string | undefined,
  to: string | null | undefined,
  text: string,
): Promise<boolean> {
  if (!token || !to) return false;

  try {
    const res = await fetch(PUSH_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // 本文にはお客様の情報が混ざらない（送った中身は返ってこない）ので、
      // 状態コードだけ残す。原因の切り分けにはこれで足りる。
      console.error("line_push_failed", res.status);
      return false;
    }
    return true;
  } catch (e) {
    console.error("line_push_error", e instanceof Error ? e.name : "unknown");
    return false;
  }
}

/**
 * お客様のメッセージに**返信**する（webhookの自動返信用）。
 *
 * ★push ではなく reply を使う。LINEの無料プランで数えられるのは push の200通で、
 *   reply は通数を消費しない。自動返信を push で送ると、お客様がトークに
 *   書くたびに1通減り、連投されるだけで月の枠が枯れて「ご予約の控え」
 *   （絶対に届けたいもの）まで止まる。
 *
 * replyToken は届いたイベントに付いてくる一度きりの引換券（有効期限は短い）。
 */
export async function replyLineUser(replyToken: string, text: string): Promise<boolean> {
  const token = process.env.LINE_CUSTOMER_CHANNEL_ACCESS_TOKEN;
  if (!token || !replyToken) return false;
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("line_reply_failed", res.status);
      return false;
    }
    return true;
  } catch (e) {
    console.error("line_reply_error", e instanceof Error ? e.name : "unknown");
    return false;
  }
}

/**
 * お客様向けアカウントの**友だち全員**へ1通送る（クーポン配信）。
 *
 * ★1回の配信で「友だちの人数ぶん」の通数を使う。
 *   個別送信とは桁が違う（友だち100人なら100通）。呼ぶ側が必ず
 *   残り通数と友だち数を見てから呼ぶこと（cron/quiet-day がその判定を持つ）。
 */
export async function broadcastLineCustomers(text: string): Promise<boolean> {
  const token = process.env.LINE_CUSTOMER_CHANNEL_ACCESS_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: [{ type: "text", text: text.slice(0, 4900) }] }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error("line_broadcast_failed", res.status);
      return false;
    }
    return true;
  } catch (e) {
    console.error("line_broadcast_error", e instanceof Error ? e.name : "unknown");
    return false;
  }
}
