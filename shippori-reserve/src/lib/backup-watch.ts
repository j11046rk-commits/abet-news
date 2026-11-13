/*
 * データの控え（バックアップ）が止まっていないかを見張る。純粋な関数だけ（node --test で回す）。
 *
 * なぜ要るか（2026-11-13）
 *   控えは店主のMacが取りに来る（api/cron/backup）。2026-08-18 に仕組みを作ったが、
 *   Mac側の設定が最後まで済んでおらず、3か月のあいだ一度も動いていなかった。
 *   「成功も失敗もLINEに流す」作りでも、そもそも動いていなければ何も流れない——
 *   止まっていることは、取りに来られる側（このアプリ）からしか気づけない。
 *
 * 決めごと
 *  ・Macが控えを取りに来て書き出しが成功したら、その時刻を settings の backup_last_at に残す
 *  ・毎日1回（api/cron/purge のついで）、最後の控えから何日たったかを見る
 *  ・8日以上止まっていたら店のLINEに知らせる。毎日は鳴らさない——8日目に1回、あとは3日おき
 *    （グループあては1回6通。直るまで毎日送ると、それだけで月の枠を削る）
 *  ・一度も取られていない（記録が無い）ときは、月曜にだけ知らせる
 */

/** settings のキー。値は最後に控えを書き出した時刻（ISO文字列） */
export const BACKUP_LAST_KEY = "backup_last_at";
/** この日数止まっていたら知らせる */
export const STALE_DAYS = 8;
/** 知らせたあと、次に知らせるまでの間隔（日） */
export const REPEAT_DAYS = 3;

const DAY_MS = 86400_000;
const JST_MS = 9 * 3600_000;

/** 日本時間の「日付の通し番号」。時刻は捨てる（何時に取ったかではなく、何日あいたかを見る） */
function jstDayNumber(d: Date): number {
  return Math.floor((d.getTime() + JST_MS) / DAY_MS);
}

/** 最後の控えから何日たったか（日本時間の日付で数える）。記録が無い・読めないときは null */
export function daysSinceBackup(lastAt: unknown, now: Date): number | null {
  if (typeof lastAt !== "string" || !lastAt) return null;
  const t = Date.parse(lastAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, jstDayNumber(now) - jstDayNumber(new Date(t)));
}

/** 今日、店のLINEに知らせる文面。知らせない日は null */
export function backupNotice(lastAt: unknown, now: Date): string | null {
  const days = daysSinceBackup(lastAt, now);
  const todo = "Macの電源とネットワーク、自動実行（com.shippori.backup）の登録を確認してください。";

  if (days === null) {
    // 記録が無い＝一度も取られていない。通し番号の 4 は月曜（1970-01-05）
    const isMonday = ((jstDayNumber(now) % 7) + 7) % 7 === 4;
    return isMonday ? `⚠️ データのバックアップが、まだ一度も取られていません。\n${todo}` : null;
  }
  if (days < STALE_DAYS) return null;
  if ((days - STALE_DAYS) % REPEAT_DAYS !== 0) return null;

  const last = new Date(Date.parse(lastAt as string) + JST_MS);
  const when = `${last.getUTCMonth() + 1}/${last.getUTCDate()}`;
  return `⚠️ データのバックアップが${days}日止まっています（最後は${when}）。\n${todo}`;
}
