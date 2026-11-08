import { fmtYen } from "@/lib/sales";
import { WEEKDAY_JA, weekdayOf } from "@/lib/time";

export type LaborCostDay = { date: string; cost: number; salesEx: number | null };

/**
 * 日ごとの人件費と人件費率（店長・オーナーだけ・店主指示 2026-11-09「この日の人件費いくら、人件費率何%を明示」）。
 * freee の給与の設定×勤怠から計算した速報（店全体の合計だけ）。給与が確定した月は、評価の画面で月の実際の合計と比べられる。
 * ★スタッフには出さない：出勤が2〜3人の日は、自分の分を引けば他の人の額が分かってしまう。
 */
export default function LaborCostDaily({ days, targetRatio }: { days: LaborCostDay[]; targetRatio: number }) {
  if (days.length === 0) {
    return (
      <section className="card" aria-label="日ごとの人件費">
        <div className="eval-card__head">
          <span className="cost-sum__label">日ごとの人件費（店長・オーナーだけ）</span>
        </div>
        <p className="micro">まだありません。⚙設定 →「freeeと連携する」をオーナーが押すと、翌朝から日ごとに出ます。</p>
      </section>
    );
  }
  const ratio = (d: LaborCostDay) => (d.salesEx != null && d.salesEx > 0 ? Math.round((d.cost / d.salesEx) * 1000) / 10 : null);
  const sumCost = days.reduce((a, d) => a + d.cost, 0);
  const sumSales = days.reduce((a, d) => a + (d.salesEx ?? 0), 0);
  const mtd = sumSales > 0 ? Math.round((sumCost / sumSales) * 1000) / 10 : null;
  return (
    <section className="card" aria-label="日ごとの人件費">
      <div className="eval-card__head">
        <span className="cost-sum__label">日ごとの人件費（店長・オーナーだけ）</span>
        <span className="eval-card__pts">{mtd != null ? `月の累計 ${mtd}%` : ""}</span>
      </div>
      <table className="eval-table" style={{ marginTop: "0.5rem" }}>
        <thead>
          <tr>
            <th>日</th>
            <th>売上（税抜）</th>
            <th>人件費</th>
            <th>人件費率</th>
          </tr>
        </thead>
        <tbody>
          {[...days].reverse().map((d) => {
            const r = ratio(d);
            return (
              <tr key={d.date}>
                <td>
                  {Number(d.date.slice(8))}日（{WEEKDAY_JA[weekdayOf(d.date)]}）
                </td>
                <td>{d.salesEx != null ? fmtYen(d.salesEx) : "—"}</td>
                <td>{fmtYen(d.cost)}</td>
                <td className={r != null && r > targetRatio ? "eval-gap--ng" : "eval-gap--ok"}>{r != null ? `${r}%` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>累計</td>
            <td>{fmtYen(sumSales)}</td>
            <td>{fmtYen(sumCost)}</td>
            <td>{mtd != null ? `${mtd}%` : "—"}</td>
          </tr>
        </tfoot>
      </table>
      <p className="micro" style={{ marginTop: "0.5rem" }}>
        freeeの時給・月給・手当（交通費）・社会保険の会社負担と、その日の勤怠から計算した速報です（店全体の合計）。目標は{targetRatio}%以下。
        月給・決まった手当・社会保険などの毎月決まった額は、その月の営業日で割って入れています。
      </p>
    </section>
  );
}
