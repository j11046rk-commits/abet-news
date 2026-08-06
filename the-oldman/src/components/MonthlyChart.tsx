import { yen } from "@/lib/money";
import type { MonthlySummary } from "@/lib/types";

/**
 * 残高の推移 — 自作SVG（DESIGN.md §9-3）。
 * 軸は下辺の真鍮ヘアライン1本だけ。グリッドは描かない。
 *
 * 収入と支出の棒は落とした。月ごとの内訳は通帳を見れば分かるし、
 * ここで知りたいのは「増えているのか減っているのか」の一本の線だけ。
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

  const balances = data.map((d) => d.balance_yen);
  const bMax = Math.max(0, ...balances);
  const bMin = Math.min(0, ...balances);
  const bSpan = Math.max(1, bMax - bMin);

  const slot = W / data.length;
  const yBal = (v: number) => PAD_T + inner - ((v - bMin) / bSpan) * inner;
  const x = (i: number) => slot * (i + 0.5);

  const line = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${yBal(d.balance_yen).toFixed(1)}`)
    .join(" ");

  // 線の下を薄く塗る。線1本だけだと、残高の「厚み」が伝わらない。
  const base = yBal(Math.max(0, bMin));
  const area = `${line} L${x(data.length - 1).toFixed(1)},${base.toFixed(1)} L${x(0).toFixed(1)},${base.toFixed(1)} Z`;

  const zeroY = bMin < 0 ? yBal(0) : null;
  const last = data[data.length - 1];

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart__svg" role="img" aria-label="残高の推移">
        {/* 残高がゼロを割る線。負の残高があるときだけ引く */}
        {zeroY !== null ? (
          <line x1="0" x2={W} y1={zeroY} y2={zeroY} className="chart__zero" />
        ) : null}

        <path d={area} className="chart__area" />
        <path d={line} className="chart__line" />

        {data.map((d, i) => (
          <g key={d.ym}>
            <circle cx={x(i)} cy={yBal(d.balance_yen)} r="2.5" className="chart__dot" />
            <text x={x(i)} y={H - 6} className="chart__tick" textAnchor="middle">
              {d.ym.slice(5)}
            </text>
          </g>
        ))}

        <line x1="0" x2={W} y1={PAD_T + inner} y2={PAD_T + inner} className="chart__axis" />
      </svg>

      <figcaption className="chart__key micro">
        <span>累計残高</span>
        <span className="chart__latest amount">
          {last.ym} · {yen(last.balance_yen)}
        </span>
      </figcaption>
    </figure>
  );
}
