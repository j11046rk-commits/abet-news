import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 公開APIの回数制限。
 *
 * SMS送信も公開キャンセルも、いまは何回でも叩ける状態だった。
 * 電話番号を変えながら回せば、店のTwilio残高で見ず知らずの人にSMSを撃ち込めるし、
 * 予約番号を 0001 から順に投げれば他人の予約を消せる。
 *
 * Twilio側の制限は「同じ番号あたり」なので、番号を変える攻撃には効かない。
 * だから3段で見る——相手ごと・送信元ごと・全体の天井。
 *
 * 記録は public_attempts（service role のみ触れる）。
 * subject は生の電話番号や予約番号ではなくハッシュを入れる。
 * 回数を数えるのが目的で、誰が試したかを残すのが目的ではない。
 */

export type Limit = { windowMin: number; max: number };

export type RateRule = {
  kind: "sms" | "cancel" | "login";
  /** 相手ごと（電話番号・予約番号・ログインID） */
  perSubject: Limit;
  /** 送信元ごと */
  perIp: Limit;
  /** 全体の天井。番号を変えられても、ここで必ず止まる */
  overall: Limit;
};

export const RATE: Record<RateRule["kind"], RateRule> = {
  // SMSは1通ずつ課金される。全体の天井が最後の砦。
  sms: {
    kind: "sms",
    perSubject: { windowMin: 60, max: 3 },
    perIp: { windowMin: 60, max: 5 },
    overall: { windowMin: 60, max: 40 },
  },
  // キャンセルは総当たりを止めるのが目的なので、失敗回数で見る
  cancel: {
    kind: "cancel",
    perSubject: { windowMin: 60, max: 5 },
    perIp: { windowMin: 60, max: 10 },
    overall: { windowMin: 60, max: 60 },
  },
  login: {
    kind: "login",
    perSubject: { windowMin: 15, max: 5 },
    perIp: { windowMin: 15, max: 20 },
    overall: { windowMin: 15, max: 100 },
  },
};

/** 生の値は保存しない。同じ相手だと分かれば足りる */
export const subjectKey = (v: string): string =>
  createHash("sha256").update(`shippori:${v}`).digest("hex").slice(0, 32);

/** Vercel の後ろにいるので、送信元は x-forwarded-for の先頭を見る */
export function clientIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim().slice(0, 60) || null;
  return headers.get("x-real-ip")?.slice(0, 60) ?? null;
}

const since = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

/**
 * 上限に達していないかを見る。達していれば false。
 *
 * ここで数えるのは「試した回数」。成功しても失敗しても1回。
 * 数え漏れより数えすぎのほうが安全なので、判定に迷ったら止める側に倒す。
 */
export async function withinLimit(
  rule: RateRule,
  subject: string,
  ip: string | null,
): Promise<boolean> {
  const admin = createAdminClient();
  const sub = subjectKey(subject);

  /** 直近◯分の試行回数。数えられなければ null（＝判定に使わない） */
  const countIn = async (
    limit: Limit,
    narrow?: { column: "subject" | "ip"; value: string },
  ): Promise<number | null> => {
    let q = admin
      .from("public_attempts")
      .select("id", { count: "exact", head: true })
      .eq("kind", rule.kind)
      .gte("created_at", since(limit.windowMin));
    if (narrow) q = q.eq(narrow.column, narrow.value);
    const { count, error } = await q;
    return error ? null : (count ?? 0);
  };

  const [bySubject, overall, byIp] = await Promise.all([
    countIn(rule.perSubject, { column: "subject", value: sub }),
    countIn(rule.overall),
    ip ? countIn(rule.perIp, { column: "ip", value: ip }) : Promise.resolve(null),
  ]);

  // 数えられなかったときは通す。ここで落として予約が止まるほうが困る
  // （SMSの天井は Twilio 側のスペンドキャップでも二重に守る）。
  if (bySubject !== null && bySubject >= rule.perSubject.max) return false;
  if (overall !== null && overall >= rule.overall.max) return false;
  if (byIp !== null && byIp >= rule.perIp.max) return false;
  return true;
}

/** 試したことを記録する。上限判定はこの記録を数える */
export async function recordAttempt(
  kind: RateRule["kind"],
  subject: string,
  ip: string | null,
  ok: boolean,
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("public_attempts")
    .insert({ kind, subject: subjectKey(subject), ip, ok });
}

/** ついでに古い記録を掃除する（1%の確率で。専用の仕組みを増やさない） */
export async function sweepSometimes(): Promise<void> {
  if (Math.random() > 0.01) return;
  const admin = createAdminClient();
  await admin.rpc("sweep_public_attempts");
}
