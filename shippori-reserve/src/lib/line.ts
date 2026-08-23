import "server-only";

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
 */

const PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";
/** LINEが遅くても、お客様の予約確定を待たせない */
const TIMEOUT_MS = 3000;

/**
 * グループへ1通送る（店のスタッフ向け）。
 * 設定が無ければ黙って何もしない（開発環境・未設定でも壊れない）。
 * 返り値は送れたかどうか。呼ぶ側はこれを見て分岐しないこと——通知は結果に影響させない。
 */
export async function pushLine(text: string): Promise<boolean> {
  return pushTo(process.env.LINE_CHANNEL_ACCESS_TOKEN, process.env.LINE_TARGET_ID, text);
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
