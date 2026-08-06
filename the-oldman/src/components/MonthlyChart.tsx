import { yen } from "@/lib/money";
import type { MonthlySummary } from "@/lib/types";

/**
 * 月次推移 — 自作SVG（DESIGN.md §9-3）。
 * 軸は下辺の真鍮ヘアライン1本だけ。グリッドは描かない。
 * 収入と支出を細い縦棒で、残高を折れ線で重ねる。
 */
export default function MonthlyChart({ rows }: { rows: MonthlySummary[] }) {
  const data = rows.slice(-12);
  if (data.length === 0) {
    return <p className="empty">まだ記帳がありません。</p>;
  }

  const W = 640;
  const H = 180;
  const PAD_B = 22;
  const PAD_T = 14;
  const inner = H - PAD_B - PAD_T;

  const maxFlow = Math.max(1, ...data.map((d) => Math.max(d.income_yen, d.expense_yen)));
  const balances = data.map((d) => d.balance_yen);
  const bMax = Math.max(0, ...balances);
  const bMin = Math.min(0, ...balances);
  const bSpan = Math.max(1, bMax - bMin);

  const slot = W / data.length;
  const barW = Math.min(10, slot * 0.18);

  const yFlow = (v: number) => PAD_T + inner - (v / maxFlow) * inner;
  const yBal = (v: number) => PAD_T + inner - ((v - bMin) / bSpan) * inner;

  const line = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${(slot * (i + 0.5)).toFixed(1)},${yBal(d.balance_yen).toFixed(1)}`)
    .join(" ");

  const zeroY = bMin < 0 ? yBal(0) : null;
  const last = data[data.length - 1];

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart__svg" role="img" aria-label="月次推移">
        {/* 残高がゼロを割る線。負の残高があるときだけ引く */}
        {zeroY !== null ? (
          <line x1="0" x2={W} y1={zeroY} y2={zeroY} className="chart__zero" />
        ) : null}

        {data.map((d, i) => {
          const cx = slot * (i + 0.5);
          return (
            <g key={d.ym}>
              <rect
                x={cx - barW - 1}
                y={yFlow(d.income_yen)}
                width={barW}
                height={PAD_T + inner - yFlow(d.income_yen)}
                className="chart__income"
              />
              <rect
                x={cx + 1}
                y={yFlow(d.expense_yen)}
                width={barW}
                height={PAD_T + inner - yFlow(d.expense_yen)}
                className="chart__expense"
              />
              <text x={cx} y={H - 6} className="chart__tick" textAnchor="middle">
                {d.ym.slice(5)}
              </text>
            </g>
          );
        })}

        <path d={line} className="chart__line" />
        {data.map((d, i) => (
          <circle
            key={d.ym}
            cx={slot * (i + 0.5)}
            cy={yBal(d.balance_yen)}
            r="2"
            className="chart__dot"
          />
        ))}

        <line x1="0" x2={W} y1={PAD_T + inner} y2={PAD_T + inner} className="chart__axis" />
      </svg>

      <p className="micro chart__scale">
        棒の天井 <span className="amount">{yen(maxFlow)}</span>
      </p>

      <figcaption className="chart__key micro">
        <span className="chart__keyitem">
          <i className="chart__swatch chart__swatch--income" />
          収入
        </span>
        <span className="chart__keyitem">
          <i className="chart__swatch chart__swatch--expense" />
          支出
        </span>
        <span className="chart__keyitem">
          <i className="chart__swatch chart__swatch--line" />
          累計残高
        </span>
        <span className="chart__latest amount">
          {last.ym} · {yen(last.balance_yen)}
        </span>
      </figcaption>
    </figure>
  );
}
