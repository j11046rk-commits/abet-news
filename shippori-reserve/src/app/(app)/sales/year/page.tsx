import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { getYearSales, type YearMonth } from "@/lib/queries";
import { fmtYen, perGuest } from "@/lib/sales";
import { fmtYm, todayBizDate } from "@/lib/time";

export const dynamic = "force-dynamic";

/** データがある一番古い年（エアレジの取り込み開始）。これより前は見に行かない */
const FIRST_YEAR = 2024;

/**
 * 年間の売上（月ごとの目標と実績）。
 *
 * 月間は「物販こみの合計」で見る（店主指示 2026-08）。日毎の画面が
 * 店内だけで見ているのと足し方が違うので、画面にもそう書いておく。
 *
 * ★進行中の月に達成率を出さない。
 *   8月17日に「8月の達成率 61%」と出すと、月末の姿と混ざって読めない。
 *   日毎の画面で同じ間違いをして直したばかりなので、ここでは最初からやらない。
 *   代わりに「途中（15日ぶん）」と、何日ぶんの数字なのかを出す。
 */
export default async function SalesYearPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string }>;
}) {
  await requireProfile();
  const sp = await searchParams;
  const today = todayBizDate();
  const thisYear = Number(today.slice(0, 4));
  const y = Number(sp.y);
  const year = Number.isInteger(y) && y >= FIRST_YEAR && y <= thisYear + 1 ? y : thisYear;

  const months = await getYearSales(year);
  const currentYm = fmtYm(today);

  const targetSum = months.reduce((a, m) => a + (m.target ?? 0), 0);
  const actualSum = months.reduce((a, m) => a + m.actual, 0);
  const retailSum = months.reduce((a, m) => a + m.retail, 0);
  // 客単価は物販を除いた店内の売上で出す（店主指示）。分子と分母は同じ日ぶんに揃える
  // （客数が取り込めていない月の売上を分子に入れない）。guestActual は物販を引いた額。
  const guestSum = months.reduce((a, m) => a + (m.guests ?? 0), 0);
  const guestSales = months.reduce((a, m) => a + (m.guestActual ?? 0), 0);
  const checkSum = months.reduce((a, m) => a + (m.checks ?? 0), 0);
  const avgPerGuest = perGuest(guestSales, guestSum);
  /** 年間目標のうち、どこまで積み上がったか。「進捗」であって成績ではない */
  const progress = targetSum > 0 ? (actualSum / targetSum) * 100 : null;

  /*
   * 達成率と前年比は「終わった月だけ」で出す。
   *
   * 8月17日に、2026年の8.5か月ぶんを2025年の12か月ぶんと比べると
   * 前年比は −44%になる。数字は正しいが、意味していることが違う——
   * 「負けている」ではなく「まだ4か月ぶん足していない」だけ。
   * 同じ間違いを日毎の画面でやって直したばかりなので、ここでも揃える。
   */
  const closed = months.filter((m) => m.ym < currentYm && m.actual > 0);
  const paceTarget = closed.reduce((a, m) => a + (m.target ?? 0), 0);
  const paceActual = closed.reduce((a, m) => a + m.actual, 0);
  const paceLastYear = closed.reduce((a, m) => a + (m.lastYear ?? 0), 0);
  const paceRate = paceTarget > 0 ? (paceActual / paceTarget) * 100 : null;
  const yoy = paceLastYear > 0 ? (paceActual / paceLastYear - 1) * 100 : null;
  const paceLabel =
    closed.length === 0
      ? ""
      : closed.length === 1
        ? `${closed[0].month}月`
        : `${closed[0].month}〜${closed[closed.length - 1].month}月`;

  // 棒の高さの基準。目標と実績のどちらか大きいほうに合わせる
  const peak = Math.max(1, ...months.map((m) => Math.max(m.target ?? 0, m.actual)));

  const state = (m: YearMonth): "done" | "now" | "future" =>
    m.ym === currentYm ? "now" : m.actual > 0 || m.ym < currentYm ? "done" : "future";

  return (
    <>
      <header className="appbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-face.png" alt="しっぽり亭" className="appbar__logo" />
        <Link
          className="btn btn-sm"
          href={`/sales/year?y=${year - 1}`}
          aria-label="前の年"
          style={{ visibility: year - 1 >= FIRST_YEAR ? "visible" : "hidden" }}
        >
          ‹
        </Link>
        <div>
          <div className="appbar__title">{year}年 売上</div>
          <div className="appbar__sub">月ごとの目標と実績</div>
        </div>
        <Link
          className="btn btn-sm"
          href={`/sales/year?y=${year + 1}`}
          aria-label="次の年"
          style={{ visibility: year + 1 <= thisYear + 1 ? "visible" : "hidden" }}
        >
          ›
        </Link>
        <div className="appbar__spacer" />
        <Link className="btn btn-sm" href={`/sales?m=${currentYm}`}>
          月へ
        </Link>
      </header>

      <div className="wrap stack">
        <section className="card">
          <p className="micro" style={{ letterSpacing: "0.12em", margin: "0 0 0.4rem" }}>
            {year}年の合計
          </p>
          <div className="summary" style={{ margin: 0 }}>
            <div className="summary__item">
              <span className="summary__num">{fmtYen(actualSum)}</span>
              <span className="summary__label">{retailSum > 0 ? "実績（物販こみ）" : "実績"}</span>
            </div>
            <div className="summary__item">
              <span className="summary__num">{targetSum > 0 ? fmtYen(targetSum) : "—"}</span>
              <span className="summary__label">目標</span>
            </div>
            <div className="summary__item">
              <span className={`summary__num ${progress !== null && progress >= 100 ? "salesnum--hit" : ""}`}>
                {progress === null ? "—" : `${progress.toFixed(1)}%`}
              </span>
              <span className="summary__label">年間目標の進捗</span>
            </div>
          </div>

          {/* 終わった月だけを揃えて比べる。ここが本当の成績 */}
          {paceLabel ? (
            <p className="micro" style={{ margin: "0.6rem 0 0", lineHeight: 1.8 }}>
              <strong>{paceLabel}</strong>で見ると、
              {paceRate !== null ? (
                <>
                  目標 {fmtYen(paceTarget)} に対して{" "}
                  <strong className={paceRate >= 100 ? "salesnum--hit" : ""}>
                    {paceRate.toFixed(1)}%
                  </strong>
                  （{fmtYen(paceActual)}）。
                </>
              ) : (
                <>実績 {fmtYen(paceActual)}。</>
              )}
              {yoy !== null ? (
                <>
                  <br />
                  前年の同じ月（{fmtYen(paceLastYear)}）と比べて{" "}
                  <strong className={yoy >= 0 ? "salesnum--hit" : ""}>
                    {yoy >= 0 ? "＋" : "−"}
                    {Math.abs(yoy).toFixed(1)}%
                  </strong>
                  。
                </>
              ) : null}
            </p>
          ) : null}

          {/* 客数と客単価。客単価は物販（お持ち帰り）を除いた店内の売上で出す（店主指示） */}
          {avgPerGuest !== null ? (
            <p className="micro" style={{ margin: "0.6rem 0 0", lineHeight: 1.8 }}>
              客数 <strong>{guestSum.toLocaleString()}名</strong>、客単価{" "}
              <strong>{fmtYen(avgPerGuest)}</strong>
              {checkSum > 0 ? `（${checkSum.toLocaleString()}組）` : ""}。
              {retailSum > 0 ? "客単価は物販を除いた店内の売上で出しています。" : ""}
            </p>
          ) : null}

          <p className="micro" style={{ margin: "0.4rem 0 0" }}>
            {retailSum > 0 ? `うち物販 ${fmtYen(retailSum)}。` : ""}
            {targetSum > 0 && actualSum < targetSum
              ? `年間目標まで あと ${fmtYen(targetSum - actualSum)}。`
              : ""}
          </p>
        </section>

        {/* 棒グラフ。実績の棒に、目標の位置を金の線で重ねる */}
        <section className="card">
          <div className="ybars" role="img" aria-label={`${year}年の月ごとの売上`}>
            {months.map((m) => {
              const st = state(m);
              const t = m.target ? Math.round((m.target / peak) * 100) : null;
              const hit = m.target != null && m.target > 0 && m.actual >= m.target;
              /*
               * 棒を目標の高さで2つに割る。
               *
               * 前は達成した月の棒を「金一色」にしていたので、目標の線が同じ金の中に
               * 埋もれて、どれだけ超えたのかが見えなかった（店主指摘 2026-08-18）。
               * 目標までを落とした金、超えたぶんを明るい金にすれば、
               * 超過そのものが棒の頭として立ち上がる。
               */
              const base = Math.round((Math.min(m.actual, m.target ?? m.actual) / peak) * 100);
              const over = hit ? Math.round((m.actual / peak) * 100) - (t ?? 0) : 0;
              return (
                <div key={m.ym} className="ybar">
                  <div className="ybar__track">
                    <span
                      className={`ybar__fill ${st === "now" ? "ybar__fill--now" : ""}`}
                      style={{ height: `${base}%` }}
                    />
                    {over > 0 ? (
                      <span
                        className={`ybar__over ${st === "now" ? "ybar__fill--now" : ""}`}
                        style={{ bottom: `${t}%`, height: `${over}%` }}
                      />
                    ) : null}
                    {t !== null ? (
                      <span className="ybar__goal" style={{ bottom: `${t}%` }} aria-hidden />
                    ) : null}
                  </div>
                  <span className={`ybar__label ${st === "now" ? "ybar__label--now" : ""}`}>
                    {m.month}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="micro" style={{ margin: "0.5rem 0 0", textAlign: "center" }}>
            棒＝実績（物販こみ）。<strong className="ylegend__over">明るい金</strong>が
            目標を超えたぶん、線がその月の目標です。
          </p>
        </section>

        <section className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="ytable">
            <thead>
              <tr>
                <th>月</th>
                <th>目標</th>
                <th>実績</th>
                <th>達成</th>
                <th>前年比</th>
                <th>客単価</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => {
                const st = state(m);
                const hit = m.target != null && m.target > 0 && m.actual >= m.target;
                const r = m.target && m.target > 0 ? (m.actual / m.target) * 100 : null;
                const yy = m.lastYear ? (m.actual / m.lastYear - 1) * 100 : null;
                const pg = perGuest(m.guestActual, m.guests);
                return (
                  <tr key={m.ym} className={st === "now" ? "ytable__now" : ""}>
                    <td>
                      <Link href={`/sales?m=${m.ym}`}>{m.month}月</Link>
                    </td>
                    <td className="num">{m.target ? fmtYen(m.target) : "—"}</td>
                    <td className={`num ${hit ? "salesnum--hit" : ""}`}>
                      {st === "future" ? "—" : fmtYen(m.actual)}
                      {m.retail > 0 ? (
                        <span className="micro" style={{ display: "block" }}>
                          物販 {fmtYen(m.retail)}
                        </span>
                      ) : null}
                    </td>
                    <td className={`num ${hit ? "salesnum--hit" : ""}`}>
                      {st === "future" || r === null ? (
                        "—"
                      ) : st === "now" ? (
                        <span className="micro">途中（{m.days}日）</span>
                      ) : (
                        <>
                          {r.toFixed(1)}%
                          {/* 何%かだけでは金額の実感が湧かない。超過・不足を円でも出す */}
                          <span className="micro" style={{ display: "block" }}>
                            {m.actual >= (m.target ?? 0) ? "＋" : "−"}
                            {fmtYen(Math.abs(m.actual - (m.target ?? 0)))}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="num">
                      {st === "future" || yy === null ? (
                        "—"
                      ) : (
                        <span className={yy >= 0 ? "salesnum--hit" : ""}>
                          {yy >= 0 ? "＋" : "−"}
                          {Math.abs(yy).toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {pg === null ? (
                        "—"
                      ) : (
                        <>
                          {fmtYen(pg)}
                          <span className="micro" style={{ display: "block" }}>
                            {m.guests?.toLocaleString()}名
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <p className="micro" style={{ textAlign: "center" }}>
          月間は<strong>物販こみの合計</strong>で見ます（日毎の画面は店内だけ・店主指示）。
          進行中の月に達成率は出しません。年の合計の「進捗」も、
          まだ足していない月があるぶん低く出ます——<strong>成績を見るときは
          「{paceLabel || "終わった月"}で見ると」の行</strong>を見てください。
          そこだけが、前年と同じ月どうしを比べた数字です。
        </p>

        <div style={{ height: "2rem" }} />
      </div>
    </>
  );
}
