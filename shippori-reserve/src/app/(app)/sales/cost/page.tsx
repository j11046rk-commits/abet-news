import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/constants";
import { fmtYen } from "@/lib/sales";
import { addDaysStr, fmtSpan, periodCost, purchaseWarnings, stockPeriods, TIMING_LABEL, type PeriodCost } from "@/lib/cost";
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
 * 入れるのは3つだけ：書類の写真（撮るだけ。毎朝の定期実行でClaudeが読む）、日曜の棚卸、捨てたもの（ロス）。
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

  const lossEx = losses.reduce((a, l) => a + l.amount_ex, 0);
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
  // 読み取り待ち・未確認は月をまたいで数える（過去の書類をまとめて撮ると、読むまでは撮った日の月に並ぶ）
  const supabase = await createClient();
  const [{ count: pendingAll }, { count: unconfirmedAll }, reader] = await Promise.all([
    supabase.from("cost_purchases").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("cost_purchases").select("id", { count: "exact", head: true }).eq("status", "unconfirmed"),
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
        <section className="card cost-sum" aria-label="原価率">
          <div className="cost-sum__head">
            <span className="cost-sum__label">原価率（棚卸の間ごと）</span>
            {weeks[0]?.ratio != null ? (
              <span className="cost-sum__big">{weeks[0].ratio.toFixed(1)}%</span>
            ) : (
              <span className="cost-sum__none">まだ出せません</span>
            )}
          </div>
          {weeks.length === 0 ? (
            <p className="micro">
              確定した棚卸が2回そろうと、その間の原価率が出ます（毎週日曜に数えると、1週間ごと）。
              {doneCount === 1 ? "　いま確定した棚卸は1回です。次の日曜で出ます。" : ""}
            </p>
          ) : (
            <ul className="cost-list" aria-label="区間ごとの原価率">
              {weeks.map((w) => (
                <WeekRow key={w.from} w={w} />
              ))}
            </ul>
          )}
          {monthSpan?.ratio != null ? (
            <p className="micro">
              この月のまとめ（{fmtSpan(monthSpan.from, monthSpan.to)}）：<strong>{monthSpan.ratio.toFixed(1)}%</strong>
              　消耗品も入れると {monthSpan.ratioWithSupplies?.toFixed(1)}%
            </p>
          ) : null}
          {now?.purchaseRatio != null ? (
            <p className="micro">
              今週（{fmtSpan(now.from, now.to)}）の目安：仕入÷売上＝{now.purchaseRatio.toFixed(1)}%（次の棚卸で原価率になります）
            </p>
          ) : null}
        </section>

        <Link className="btn btn-block" href={draft ? `/sales/cost/stock?d=${draft.as_of}` : "/sales/cost/stock"}>
          {draft ? `棚卸（数えている途中：${fmtDateShort(draft.counted_on)} ${TIMING_LABEL[draft.timing]}）` : "棚卸（毎週日曜）"} ›
        </Link>

        <section className="card cost-sum" aria-label="この月の仕入">
          <div className="cost-sum__head">
            <span className="cost-sum__label">{fmtMonthJa(`${ym}-01`)}の仕入（税抜）</span>
          </div>
          <dl className="kv cost-kv">
            <dt>売上（税抜）</dt>
            <dd>
              {mc.salesEx != null ? fmtYen(mc.salesEx) : "—"}
              <span className="micro">　{mc.salesDays}日分</span>
            </dd>
            <dt>仕入 食材</dt>
            <dd>{fmtYen(mc.food)}</dd>
            <dt>仕入 酒・飲料</dt>
            <dd>{fmtYen(mc.drink)}</dd>
            <dt>消耗品</dt>
            <dd>{fmtYen(mc.supplies)}</dd>
            {mc.other ? (
              <>
                <dt>その他</dt>
                <dd>{fmtYen(mc.other)}</dd>
              </>
            ) : null}
            <dt>ロス（捨てたもの）</dt>
            <dd>
              {fmtYen(lossEx)}
              <span className="micro">　{losses.length}件</span>
            </dd>
            <dt>目安：仕入÷売上</dt>
            <dd>{mc.purchaseRatio != null ? `${mc.purchaseRatio.toFixed(1)}%` : "—"}</dd>
          </dl>
          <p className="micro">
            金額はすべて税抜（税理士の月次報告と同じ物差し）。目安は在庫の増減を入れていない数字です。
            {mc.prorated ? "月締めの請求書は、対象の期間で日割りしています。" : ""}
          </p>
        </section>

        {pendingAll || unconfirmedAll ? (
          <section className="notice" aria-label="読み取りの状況">
            {pendingAll ? <p>📷 読み取り待ち {pendingAll}枚（明朝AIが読みます。読むまでは原価に入りません）</p> : null}
            {unconfirmedAll ? <p>✓ 未確認 {unconfirmedAll}件（原価には入っています。写真と見比べて「確認した」を）</p> : null}
          </section>
        ) : null}

        {warnings.length > 0 ? (
          <section className="notice notice-strong" aria-label="二重のおそれ">
            {warnings.map((w) => (
              <p key={w.text}>⚠ {w.text}</p>
            ))}
          </section>
        ) : null}

        <CostPanels
          ym={ym}
          today={today}
          canWrite={canWrite}
          purchases={purchases}
          losses={losses}
          photos={photos}
          warnIds={warnings.flatMap((w) => w.ids)}
        />

        <section className="notice micro">
          使い方：<strong>納品書とレシートを毎日撮る</strong>（撮るだけ）。毎朝AIがまとめて読み、未確認として並びます。
          請求書は撮らずに、月初に納品書と紙で突き合わせる（両方入れると二重になり、上に⚠が出ます）。
          納品書が無い月締めの業者だけ、請求書を撮ってください。
        </section>

        {me.role === "owner" ? <ReaderSetup issuedAt={reader?.created_at ?? null} lastUsedAt={reader?.last_used_at ?? null} /> : null}
        <div style={{ height: "2rem" }} />
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
