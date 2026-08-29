/**
 * LINE友だち数のKPI表示（店主要望 2026-08-29）。
 * 総数・この月の増減に加えて、目標（settings.line_followers_target）までの
 * 残りと進捗バーを出す。暦（ホーム）と売上タブの2か所で同じ見た目にする。
 *
 * 店頭の声かけ（友だち追加で500円クーポン）の成果が毎日ここに出る——
 * 数字が動くのが見えることが、続ける一番の燃料になる。
 */
export default function LineFollowersKpi({
  latest,
  monthGain,
  target,
  targetLabel,
}: {
  /** いまの友だち総数。データが無ければ null（何も出さない） */
  latest: number | null;
  /** この月の増減。基準が無い月は null */
  monthGain: number | null;
  /** 目標人数。0以下なら目標表示なし */
  target: number;
  /** 目標の呼び名（例: 「9月末」）。月ごとの階段目標だと分かるように */
  targetLabel?: string;
}) {
  if (latest == null) return null;
  const hasTarget = target > 0;
  const done = hasTarget && latest >= target;
  const pct = hasTarget ? Math.min(100, (latest / target) * 100) : 0;

  return (
    <div className="linefollow">
      <p className="linefollow__text">
        LINE友だち <strong>{latest}人</strong>
        {monthGain != null && monthGain !== 0
          ? `（この月 ${monthGain > 0 ? "+" : ""}${monthGain}人）`
          : ""}
        {hasTarget ? (
          done ? (
            <span className="linefollow__done">　{targetLabel ?? "目標"}の{target}人 達成！🎉</span>
          ) : (
            `　${targetLabel ?? "目標"}の目標${target}人まであと${target - latest}人`
          )
        ) : null}
      </p>
      {hasTarget ? (
        <div className="linefollow__track" aria-label={`目標${target}人への進捗 ${Math.round(pct)}%`}>
          <div
            className={`linefollow__fill${done ? " linefollow__fill--done" : ""}`}
            style={{ width: `${pct.toFixed(1)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
