import { yen } from "@/lib/money";
import type { MonthlySummary } from "@/lib/types";

/**
 * 年間の積立。直近12ヶ月の運営積立金（出資を除く）を横棒で並べる。
 *
 * 知りたいのは「先月より稼げているか」「目標に届いた月がどれだけあるか」。
 * 棒の長さは共通の物差し（最大値と目標の大きい方）で割る。月ごとに
 * 物差しが変わると、長さの比較ができなくなる。
 */
export default function YearlyRake({
  rows,
  target,
  currentYm,
}: {
  rows: MonthlySummary[];
  target: number;
  currentYm: string;
}) {
  const byYm = new Map(rows.map((r) => [r.ym, r.operating_income_yen]));

  // 直近12ヶ月（古い順）。記帳が無い月も行として出す — 開催ゼロの月は「無い」ことが情報。
  const [cy, cm] = currentYm.split("-").map(Number);
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(cy, cm - 1 - (11 - i), 1));
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return { ym, amount: byYm.get(ym) ?? 0 };
  });

  const scale = Math.max(target, ...months.map((m) => m.amount));
  if (scale <= 0) return null;

  return (
    <div className="yr">
      {months.map((m) => {
        const [y, mo] = m.ym.split("-");
        const reached = m.amount >= target;
        return (
          <div key={m.ym} className={`yr__row${m.ym === currentYm ? " is-now" : ""}`}>
            <span className="yr__ym num">
              {y.slice(2)}.{mo}
            </span>
            <span className="yr__track">
              <span
                className={`yr__bar${reached ? " is-reached" : ""}`}
                style={{ width: `${(m.amount / scale) * 100}%` }}
              />
              {/* 目標の位置。ここを越えた月は家賃を賄えた月 */}
              <span className="yr__target" style={{ left: `${(target / scale) * 100}%` }} />
            </span>
            <span className={`yr__amt amount${m.amount === 0 ? " dim" : ""}`}>
              {m.amount === 0 ? "—" : yen(m.amount)}
            </span>
          </div>
        );
      })}
      <p className="micro yr__note">縦線は月次目標 {yen(target)}。越えた月は家賃を賄えた月。</p>
    </div>
  );
}
