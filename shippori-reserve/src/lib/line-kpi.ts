/**
 * LINE友だちの月別目標（店主要望 2026-08-29）。
 *
 * settings.line_followers_targets に {"2026-09": 102, ...} の形で
 * 「各月末時点の目標人数」が入っている。声かけの目安
 * 「平日+2人・金土+3人（火曜定休は0）」を積み上げた右肩上がりの階段。
 *
 * 表示中の月に定義が無ければ、それ以前で一番近い月の値を使う
 * （来年1月をまだ決めていなくても、12月の目標がそのまま続いて見える）。
 */
export function lineTargetFor(raw: unknown, ym: string): number {
  // 旧形式（単一の数値）もそのまま通す
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (!raw || typeof raw !== "object") return 0;

  const map = raw as Record<string, unknown>;
  const keys = Object.keys(map)
    .filter((k) => /^\d{4}-\d{2}$/.test(k))
    .sort();
  if (keys.length === 0) return 0;

  let val = 0;
  for (const k of keys) {
    if (k > ym) break;
    val = Number(map[k]) || val;
  }
  // 最初の定義より前の月を見ているときは、最初の月の値
  return val || Number(map[keys[0]]) || 0;
}
