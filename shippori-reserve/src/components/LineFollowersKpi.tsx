/**
 * LINE友だち数のKPI表示（店主要望 2026-08-29、月初リセット方式へ 2026-10-02）。
 *
 * 目標は「月初の人数を0として、日々の目標（平日+2・金土+3）を積み上げた数」。
 * 月末目標の人数と、今日までに積み上がっているべきペースの両方を出す——
 * 「あと何人」だけだと月末まで安心してしまうので、今日の時点で
 * 遅れているか進んでいるかが見えるようにする。
 * 暦（ホーム）と売上タブの2か所で同じ見た目にする。
 */
export default function LineFollowersKpi({
  latest,
  monthGain,
  monthGoal,
  goalToDate,
  monthLabel,
}: {
  /** いまの友だち総数。データが無ければ null（何も出さない） */
  latest: number | null;
  /** この月の増減（月初の前日比）。基準が無い月は null */
  monthGain: number | null;
  /** この月の増加目標（日々の目標の合計）。0以下なら目標表示なし */
  monthGoal: number;
  /** 今日までに積み上がっているべき目標（ペース） */
  goalToDate: number;
  /** 月の呼び名（例: 「10月」） */
  monthLabel: string;
}) {
  if (latest == null) return null;
  const hasTarget = monthGoal > 0 && monthGain != null;
  const gain = monthGain ?? 0;
  const done = hasTarget && gain >= monthGoal;
  const pct = hasTarget ? Math.max(0, Math.min(100, (gain / monthGoal) * 100)) : 0;
  const paceDiff = gain - goalToDate;

  return (
    <div className="linefollow">
      <p className="linefollow__text">
        LINE友だち <strong>{latest}人</strong>
        {monthGain != null ? `（${monthLabel} ${monthGain >= 0 ? "+" : ""}${monthGain}人）` : ""}
        {hasTarget ? (
          done ? (
            <span className="linefollow__done">　{monthLabel}の目標+{monthGoal}人 達成！🎉</span>
          ) : (
            `　${monthLabel}の目標+${monthGoal}人まであと${monthGoal - gain}人`
          )
        ) : null}
      </p>
      {hasTarget && !done ? (
        <p className={`linefollow__pace${paceDiff >= 0 ? " linefollow__pace--ok" : ""}`}>
          今日までのペース目標 +{goalToDate}人
          {paceDiff >= 0 ? `（${paceDiff}人先行 ✓）` : `（${-paceDiff}人遅れ）`}
        </p>
      ) : null}
      {hasTarget ? (
        <div className="linefollow__track" aria-label={`今月の目標+${monthGoal}人への進捗 ${Math.round(pct)}%`}>
          <div
            className={`linefollow__fill${done ? " linefollow__fill--done" : ""}`}
            style={{ width: `${pct.toFixed(1)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
