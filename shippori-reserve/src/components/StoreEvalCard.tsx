import { pointsOf } from "@/lib/store-eval";
import type { MonthEval } from "@/lib/store-eval-data";

/**
 * 店舗評価のカード（店主指定 2026-11-09「店長の評価ではなく店舗評価として、全員が見られる」）。
 * 売上タブ（全員）と、設定の「評価」（店長・オーナー）で同じものを出す。
 *
 * ★「%」は人件費率・原価率そのものにだけ使う。目標に対する出来は「点」（目標どおり＝100点・上限120点）。
 *   達成率を「%」で並べると、人件費率の27.3%と達成率の91.5%が同じ見た目になって紛らわしい（店主指摘 2026-11-09）。
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
        {e.metrics.map((m) => {
          const pts = pointsOf(m.rate);
          return (
            <li key={m.key} className="eval-row">
              <div className="eval-row__top">
                <span className="eval-row__label">{m.label}</span>
                <span className={`eval-row__pts${m.good ? " eval-row__pts--ok" : ""}`}>{pts != null ? `${pts}点` : "—"}</span>
              </div>
              <div className="eval-row__value">
                <strong>{m.actual}</strong>
                <span className="micro">　目標 {m.target}</span>
              </div>
              {pts != null ? (
                <div className="eval-bar" aria-hidden>
                  <span style={{ width: `${(pts / 120) * 100}%` }} />
                  <i style={{ left: `${(100 / 120) * 100}%` }} />
                </div>
              ) : null}
              <div className="micro">
                {m.gap ? <span className={m.good ? "eval-gap--ok" : "eval-gap--ng"}>{m.good ? "✓ " : ""}{m.gap}</span> : null}
                {m.gap && m.note ? "　" : ""}
                {m.note}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="micro">
        {e.salesNote ? `売上は${e.salesNote}。` : ""}
        各項目は目標どおりで100点（上限120点）。店舗評価はその重みつき平均（売上40・原価率25・人件費率20・LINE友だち10・人時売上5）。S 105点〜／A 100〜／B 95〜／C 90〜／D 90未満
      </p>
    </section>
  );
}
