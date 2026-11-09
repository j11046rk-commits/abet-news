import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/constants";
import { fmtYen } from "@/lib/sales";
import { addDaysStr, fmtSpan, lossTotal, periodCost, purchaseWarnings, stockPeriods, TIMING_LABEL, type PeriodCost } from "@/lib/cost";
import { getMonthLosses, getPurchasesRange, getSalesRange, getStocktakes, signedPhotoUrls } from "@/lib/cost-data";
import { apiTokenInfo } from "@/lib/api-token";
import { createClient } from "@/lib/supabase/server";
import { fmtDateShort, fmtMonthJa, fmtYm, monthRange, shiftDate, shiftMonth, todayBizDate } from "@/lib/time";
import CostPanels from "./CostPanels";
import ReaderSetup from "./ReaderSetup";

export const dynamic = "force-dynamic";

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * 原価（売上タブの中・オーナー/店長/事務）。
 *
 * 原価率＝（始めの在庫＋仕入−終わりの在庫）÷ 売上（どれも税抜）。
 * 棚卸は毎週日曜（店主指示 2026-11-09）。原価率は確定した棚卸と次の確定した棚卸の間（ふだん1週間）ごとに出し、
 * 月の数字はその月に終わった区間をつなげたもの（暦の1日〜末日とは少しずれる。期間をそのまま書く）。
 * 入れるのは3つだけ：書類の写真（撮るだけ。毎朝の定期実行でClaudeが読む）、日曜の棚卸、ロス（廃棄・まかない）。
 * スタッフも原価タブを見て、ロスの写真を撮れる（0073）。仕入・棚卸・ロスの直し・消しはオーナー・店長・事務。
 * 読み取りはサブスクのClaudeのセッションが /api/cost/reader から取りに来る（API料金を使わない・店主指示 2026-11-06）。
 */
export default async function CostPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const me = await requirePermission("cost.read");
  const sp = await searchParams;
  const today = todayBizDate();
  const ym = YM_RE.test(sp.m ?? "") ? sp.m! : fmtYm(today);
  const { from, to } = monthRange(ym);

  const stocks = await getStocktakes(shiftDate(from, -120));
  const periods = stockPeriods(stocks).filter((x) => x.to >= from && x.to <= to);
  const spanFrom = periods[0] && periods[0].from < from ? periods[0].from : from;
  const lastDone = stocks.find((s) => s.status === "done" && s.as_of <= today) ?? null;
  const isCurrent = ym === fmtYm(today);
  const weekFrom = isCurrent && lastDone && lastDone.as_of >= shiftDate(today, -14) ? addDaysStr(lastDone.as_of, 1) : null;
  const readFrom = weekFrom && weekFrom < spanFrom ? weekFrom : spanFrom;

  const [sales, allPurchases, losses] = await Promise.all([
    getSalesRange(readFrom, to),
    // 月締めの請求書は締め日（翌月のこともある）で計上されるので、日割りのため少し先まで読む
    getPurchasesRange(readFrom, shiftDate(to, 45)),
    getMonthLosses(ym),
  ]);
  const purchases = allPurchases.filter((p) => p.book_date >= from && p.book_date <= to);

  const lossEx = lossTotal(losses);
  const mc = periodCost({ from, to, sales, purchases: allPurchases, open: null, close: null });
  const weeks = periods.map((x) => periodCost({ ...x, sales, purchases: allPurchases })).reverse();
  const monthSpan =
    periods.length >= 2
      ? periodCost({ from: periods[0]!.from, to: periods.at(-1)!.to, sales, purchases: allPurchases, open: periods[0]!.open, close: periods.at(-1)!.close })
      : null;
  const now = weekFrom && weekFrom <= today ? periodCost({ from: weekFrom, to: today, sales, purchases: allPurchases, open: lastDone, close: null }) : null;
  const warnings = purchaseWarnings(purchases);
  const photos = await signedPhotoUrls([...purchases.map((p) => p.photo_path ?? ""), ...losses.map((l) => l.photo_path ?? "")]);
  const canWrite = can(me.role, "cost.write");
  const canLoss = can(me.role, "cost.loss");
  // 読み取り待ち・未確認は月をまたいで数える（過去の書類をまとめて撮ると、読むまでは撮った日の月に並ぶ）
  const supabase = await createClient();
  const [{ count: pendingAll }, { count: unconfirmedAll }, { count: lossPending }, { count: lossUnconfirmed }, reader] = await Promise.all([
    supabase.from("cost_purchases").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("cost_purchases").select("id", { count: "exact", head: true }).eq("status", "unconfirmed"),
    supabase.from("cost_losses").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("cost_losses").select("id", { count: "exact", head: true }).eq("status", "unconfirmed"),
    me.role === "owner" ? apiTokenInfo("cost_reader") : Promise.resolve(null),
  ]);
  const draft = stocks.find((s) => s.status === "draft") ?? null;
  const doneCount = stocks.filter((s) => s.status === "done").length;

  return (
    <>
      <header className="appbar">
        <Link className="btn btn-sm" href={`/sales/cost?m=${fmtYm(shiftMonth(`${ym}-01`, -1))}`} aria-label="前の月">
          ‹
        </Link>
        <div>
          <div className="appbar__title">{fmtMonthJa(`${ym}-01`)} 原価</div>
          <div className="appbar__sub">仕入・棚卸・ロス</div>
        </div>
        <Link className="btn btn-sm" href={`/sales/cost?m=${fmtYm(shiftMonth(`${ym}-01`, 1))}`} aria-label="次の月">
          ›
        </Link>
        <div className="appbar__spacer" />
        <Link className="btn btn-sm" href={`/sales?m=${ym}`}>
          売上へ
        </Link>
      </header>

      <div className="wrap stack">
        <CostPanels
          ym={ym}
          today={today}
          canWrite={canWrite}
          lossOn={canLoss && isCurrent}
          purchases={purchases}
          losses={losses}
          photos={photos}
          warnIds={warnings.flatMap((w) => w.ids)}
          summary={
            <>
              <section className="card cost-hero" aria-label="原価率">
                <div className="cost-hero__nums">
                  <div>
                    <div className="cost-hero__label">原価率</div>
                    <div className="cost-hero__big">{weeks[0]?.ratio != null ? `${weeks[0].ratio.toFixed(1)}%` : "—"}</div>
                    <div className="cost-hero__sub">
                      {weeks[0] ? fmtSpan(weeks[0].from, weeks[0].to) : doneCount === 1 ? "次の棚卸で出ます" : "棚卸2回で出ます"}
                    </div>
                  </div>
                  <div>
                    <div className="cost-hero__label">今月 仕入÷売上</div>
                    <div className="cost-hero__mid">{mc.purchaseRatio != null ? `${mc.purchaseRatio.toFixed(1)}%` : "—"}</div>
                    <div className="cost-hero__sub">売上 {mc.salesEx != null ? fmtYen(mc.salesEx) : "—"}</div>
                  </div>
                </div>
                <CostBar
                  parts={[
                    { key: "food", label: "食材", v: mc.food },
                    { key: "drink", label: "酒・飲料", v: mc.drink },
                    { key: "supplies", label: "消耗品", v: mc.supplies },
                    { key: "other", label: "その他", v: mc.other },
                    { key: "loss", label: "ロス", v: lossEx },
                  ]}
                />
                {weeks.length || now?.purchaseRatio != null ? (
                  <details className="cost-more">
                    <summary>週ごと</summary>
                    <ul className="cost-list">
                      {weeks.map((w) => (
                        <WeekRow key={w.from} w={w} />
                      ))}
                    </ul>
                    {monthSpan?.ratio != null ? (
                      <p className="micro">
                        月まとめ {fmtSpan(monthSpan.from, monthSpan.to)}：<strong>{monthSpan.ratio.toFixed(1)}%</strong>（消耗品込み {monthSpan.ratioWithSupplies?.toFixed(1)}%）
                      </p>
                    ) : null}
                    {now?.purchaseRatio != null ? (
                      <p className="micro">
                        今週 {fmtSpan(now.from, now.to)}：仕入÷売上 {now.purchaseRatio.toFixed(1)}%
                      </p>
                    ) : null}
                  </details>
                ) : null}
                <p className="cost-hero__foot">税抜{mc.prorated ? "・請求書は日割り" : ""}</p>
              </section>

              <Link className="btn btn-block" href={draft ? `/sales/cost/stock?d=${draft.as_of}` : "/sales/cost/stock"}>
                📋 {draft ? `棚卸（途中：${fmtDateShort(draft.counted_on)} ${TIMING_LABEL[draft.timing]}）` : "棚卸（毎週日曜）"} ›
              </Link>

              {pendingAll || unconfirmedAll || lossPending || lossUnconfirmed ? (
                <div className="cost-badges" aria-label="状況">
                  {unconfirmedAll ? <span className="cost-badge cost-badge--warn">✓ 未確認 {unconfirmedAll}</span> : null}
                  {pendingAll ? <span className="cost-badge">📷 読み取り待ち {pendingAll}</span> : null}
                  {lossUnconfirmed ? <span className="cost-badge cost-badge--warn">🗑 ロス未確認 {lossUnconfirmed}</span> : null}
                  {lossPending ? <span className="cost-badge">🗑 ロス読み取り待ち {lossPending}</span> : null}
                </div>
              ) : null}

              {warnings.length > 0 ? (
                <section className="notice notice-strong" aria-label="二重のおそれ">
                  {warnings.map((w) => (
                    <p key={w.text}>⚠ {w.text}</p>
                  ))}
                </section>
              ) : null}
            </>
          }
        />

        <details className="card cost-more">
          <summary>❓ 使い方</summary>
          <ul className="howto">
            <li>📷 納品書・レシートを毎日撮る（撮るだけ）</li>
            <li>🤖 毎朝AIが読んで、未確認として並ぶ</li>
            <li>✓ 写真と見比べて OK を押す</li>
            <li>🗑 捨てた物・まかないも撮る</li>
            <li>📄 請求書は、納品書が無い業者だけ（両方入れると⚠）</li>
          </ul>
        </details>

        {me.role === "owner" ? <ReaderSetup issuedAt={reader?.created_at ?? null} lastUsedAt={reader?.last_used_at ?? null} /> : null}
        <div style={{ height: "2rem" }} />
      </div>
    </>
  );
}

/** 仕入とロスの内訳を1本の帯で（色は区分の色） */
function CostBar({ parts }: { parts: { key: string; label: string; v: number }[] }) {
  const shown = parts.filter((x) => x.v > 0);
  const sum = shown.reduce((a, x) => a + x.v, 0);
  if (sum === 0) return <p className="micro">今月の仕入はまだありません</p>;
  return (
    <>
      <div className="cost-bar" aria-hidden>
        {shown.map((x) => (
          <span key={x.key} className={`cost-bar__seg cost-bar__seg--${x.key}`} style={{ flexGrow: x.v }} />
        ))}
      </div>
      <div className="cat-chips">
        {shown.map((x) => (
          <span key={x.key} className={`cat-chip cat-chip--${x.key}`}>
            {x.label}
            <strong>{fmtYen(x.v)}</strong>
            <span className="cat-chip__kind">{x.key === "food" || x.key === "drink" ? "原価" : x.key === "loss" ? "" : "経費"}</span>
          </span>
        ))}
      </div>
    </>
  );
}

function WeekRow({ w }: { w: PeriodCost }) {
  return (
    <li className="cost-row">
      <div className="cost-row__main">
        <span className="cost-row__vendor">{fmtSpan(w.from, w.to)}</span>
        <span className="cost-row__amt">{w.ratio != null ? `${w.ratio.toFixed(1)}%` : "—"}</span>
      </div>
      <span className="micro">
        売上 {w.salesEx != null ? fmtYen(w.salesEx) : "—"}・原価 {w.cogs != null ? fmtYen(w.cogs) : "—"}
        {w.ratioWithSupplies != null ? `・消耗品込み ${w.ratioWithSupplies.toFixed(1)}%` : ""}
        {w.ratio == null && w.missing.length ? `（足りないもの：${w.missing.join("・")}）` : ""}
      </span>
    </li>
  );
}
