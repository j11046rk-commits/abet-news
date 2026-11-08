import type { MonthEval } from "@/lib/store-eval-data";

/**
 * 店舗評価のカード（店主指定 2026-11-09「店長の評価ではなく店舗評価として、全員が見られる」）。
 * 売上タブ（全員）と、設定の「評価」（店長・オーナー）で同じものを出す。
 */
export default function StoreEvalCard({ e, title }: { e: MonthEval; title: string }) {
  return (
    <section className="card eval-card" aria-label="店舗評価">
      <div className="eval-card__head">
        <span className="cost-sum__label">店舗評価（{title}）</span>
        {e.rank ? (
          <span className="eval-card__score">
            <span className={`eval-rank eval-rank--${e.rank}`}>{e.rank}</span>
            <span className="eval-card__pts">{e.score?.toFixed(1)}点</span>
          </span>
        ) : (
          <span className="cost-sum__none">まだ出せません</span>
        )}
      </div>
      <ul className="eval-list">
        {e.metrics.map((m) => (
          <li key={m.key} className="eval-row">
            <div className="eval-row__top">
              <span className="eval-row__label">{m.label}</span>
              <span className={`eval-row__rate${m.rate != null && m.rate >= 100 ? " eval-row__rate--ok" : ""}`}>
                {m.rate != null ? `${m.rate.toFixed(1)}%` : "—"}
              </span>
            </div>
            {m.rate != null ? (
              <div className="eval-bar" aria-hidden>
                <span style={{ width: `${Math.min(100, (m.rate / 120) * 100)}%` }} />
                <i style={{ left: `${(100 / 120) * 100}%` }} />
              </div>
            ) : null}
            <div className="micro">
              実際 {m.actual} ／ 目標 {m.target}
              {m.note ? `（${m.note}）` : ""}
            </div>
          </li>
        ))}
      </ul>
      <p className="micro">
        {e.salesNote ? `売上は${e.salesNote}。` : ""}
        点数＝達成率（上限120%）の重みつき平均（売上40・人件費30・原価30）。S 105〜／A 100〜／B 95〜／C 90〜／D 90未満
      </p>
    </section>
  );
}
