import "server-only";

/**
 * お客様向けアカウントの、今月あと何通送れるか。
 *
 * ★無料プランは月200通で、使い切ったら**黙って届かなくなる**（店主判断 2026-08）。
 *   困る順番は決まっている。
 *
 *     ご予約の控え … 届かないと「予約できていないのでは」と不安にさせる。絶対に届けたい
 *     前日リマインド … 届かなくても、お客様は予約したことを覚えている。後回しでよい
 *
 *   何もしなければ「先に来たものから使う」ので、月末に控えのほうが止まる——順番が逆。
 *   だから残りが少なくなったら、**リマインドだけを止めて控えのぶんを空けておく**。
 *
 * 数え方はLINEに聞く（/v2/bot/message/quota と /consumption）。
 * 自分で数えると、管理画面から手で送ったぶんが漏れて必ず食い違う。
 */

/** これだけは控えのために空けておく（＝ひと月の予約件数の見込みぶん） */
export const RESERVED_FOR_BOOKINGS = 60;

export type Quota = {
  /** 今月の上限。無制限のプランなら null */
  limit: number | null;
  /** 今月すでに送った数 */
  used: number;
  /** あと何通送れるか。無制限なら null */
  remaining: number | null;
};

const TIMEOUT_MS = 3000;

async function get(path: string, token: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    console.error("line_quota_failed", path, res.status);
    return null;
  }
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

/**
 * 残り通数を調べる。分からなければ null。
 *
 * ★分からないときは「送る」に倒す。
 *   調べられないことを理由にリマインドを止めると、LINEの調子が悪い日や
 *   仕様が変わった日に、誰にも気づかれないまま連絡が止まる。
 *   止まったことに気づけない仕組みのほうが、1通多く使うより危ない。
 */
export async function customerQuota(): Promise<Quota | null> {
  const token = process.env.LINE_CUSTOMER_CHANNEL_ACCESS_TOKEN;
  if (!token) return null;

  try {
    const [quota, consumption] = await Promise.all([get("quota", token), get("quota/consumption", token)]);
    if (!quota) return null;

    // type: "none"（無制限）か "limited"（上限あり）
    const limit = quota.type === "limited" && typeof quota.value === "number" ? quota.value : null;
    const used = typeof consumption?.totalUsage === "number" ? consumption.totalUsage : 0;

    return { limit, used, remaining: limit === null ? null : Math.max(0, limit - used) };
  } catch (e) {
    console.error("line_quota_error", e instanceof Error ? e.name : "unknown");
    return null;
  }
}

/**
 * 友だちの人数（＝配信が届く見込みの人数）。分からなければ null。
 *
 * LINEの統計API（insight/followers）に聞く。数字が確定するのは翌日なので
 * 昨日の日付で聞く——配信の可否を決めるための概算としてはそれで足りる。
 * 自前の line_friends 表で数えないのは、webhookを入れる前からの友だち
 * （生ビールクーポンで集めた人たち）が表に載っていないため。実際より
 * 少なく見積もると、通数の守りが甘くなる方向に外れる。
 */
export async function customerReach(): Promise<number | null> {
  const token = process.env.LINE_CUSTOMER_CHANNEL_ACCESS_TOKEN;
  if (!token) return null;

  const y = new Date(Date.now() + 9 * 3600 * 1000 - 86400 * 1000);
  const date = y.toISOString().slice(0, 10).replace(/-/g, "");

  try {
    const res = await fetch(`https://api.line.me/v2/bot/insight/followers?date=${date}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("line_reach_failed", res.status);
      return null;
    }
    const body = (await res.json().catch(() => null)) as {
      status?: string;
      followers?: number;
      targetedReaches?: number;
    } | null;
    if (!body || body.status !== "ready") return null;
    // targetedReaches＝実際に届く人数（ブロックを除く）。無ければ友だち数で代用
    const n = body.targetedReaches ?? body.followers;
    return typeof n === "number" ? n : null;
  } catch (e) {
    console.error("line_reach_error", e instanceof Error ? e.name : "unknown");
    return null;
  }
}
