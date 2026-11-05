import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/constants";
import { getMonthSales } from "@/lib/queries";
import { fmtYen } from "@/lib/sales";
import { monthCost, prevYm, purchaseWarnings } from "@/lib/cost";
import { getMonthLosses, getMonthPurchases, getStocktakes, signedPhotoUrls } from "@/lib/cost-data";
import { aiReady } from "@/lib/cost-ai";
import { fmtMonthJa, fmtYm, shiftMonth, todayBizDate } from "@/lib/time";
import CostPanels from "./CostPanels";

export const dynamic = "force-dynamic";

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * 原価（売上タブの中・オーナー/店長/事務）。
 *
 * 原価率＝（月初在庫＋仕入−月末在庫）÷ 売上（どちらも税抜）。
 * 入れるのは3つだけ：書類の写真（AIが読む→確認して保存）、月末の棚卸、捨てたもの（ロス）。
 */
export default async function CostPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const me = await requirePermission("cost.read");
  const sp = await searchParams;
  const today = todayBizDate();
  const ym = YM_RE.test(sp.m ?? "") ? sp.m! : fmtYm(today);
  const prev = prevYm(ym);

  const [sales, purchases, losses, stocks, prevPurchases, prevSales, prevStocks] = await Promise.all([
    getMonthSales(ym),
    getMonthPurchases(ym),
    getMonthLosses(ym),
    getStocktakes([prev, ym]),
    getMonthPurchases(prev),
    getMonthSales(prev),
    getStocktakes([prevYm(prev)]),
  ]);

  const lossEx = losses.reduce((a, l) => a + l.amount_ex, 0);
  const mc = monthCost({
    sales: [...sales.values()],
    purchases,
    open: stocks.get(prev) ?? null,
    close: stocks.get(ym) ?? null,
    lossEx,
  });
  const pc = monthCost({
    sales: [...prevSales.values()],
    purchases: prevPurchases,
    open: prevStocks.get(prevYm(prev)) ?? null,
    close: stocks.get(prev) ?? null,
  });
  const warnings = purchaseWarnings(purchases);
  const photos = await signedPhotoUrls([...purchases.map((p) => p.photo_path ?? ""), ...losses.map((l) => l.photo_path ?? "")]);
  const canWrite = can(me.role, "cost.write");
  const isCurrent = ym === fmtYm(today);
  const closeSt = stocks.get(ym);

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
            <span className="cost-sum__label">原価率</span>
            {mc.ratio != null ? (
              <span className="cost-sum__big">{mc.ratio.toFixed(1)}%</span>
            ) : (
              <span className="cost-sum__none">まだ出せません</span>
            )}
          </div>
          {mc.ratio == null ? (
            <p className="micro">
              足りないもの：{mc.missing.join("・")}
              {mc.purchaseRatio != null ? (
                <>
                  <br />
                  目安：仕入÷売上＝<strong>{mc.purchaseRatio.toFixed(1)}%</strong>（在庫の増減を入れていない数字です）
                </>
              ) : null}
            </p>
          ) : (
            <p className="micro">
              消耗品も入れると {mc.ratioWithSupplies?.toFixed(1)}%
              {pc.ratio != null ? `／先月 ${pc.ratio.toFixed(1)}%` : ""}
            </p>
          )}
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
            <dt>月初の在庫</dt>
            <dd>{mc.openStock != null ? fmtYen(mc.openStock) : "—"}</dd>
            <dt>月末の在庫</dt>
            <dd>{mc.closeStock != null ? fmtYen(mc.closeStock) : closeSt?.status === "draft" ? "数えている途中" : "—"}</dd>
            <dt>売上原価</dt>
            <dd>{mc.cogs != null ? fmtYen(mc.cogs) : "—"}</dd>
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
          </dl>
          <p className="micro">金額はすべて税抜。税理士の月次報告と同じ物差しです。</p>
        </section>

        {warnings.length > 0 ? (
          <section className="notice notice-strong" aria-label="二重のおそれ">
            {warnings.map((w) => (
              <p key={w.text}>⚠ {w.text}</p>
            ))}
          </section>
        ) : null}

        <Link className="btn btn-block" href={`/sales/cost/stock?m=${ym}`}>
          {fmtMonthJa(`${ym}-01`)}末の棚卸
          {closeSt?.status === "done" ? "（確定済み）" : closeSt ? "（途中）" : isCurrent ? "（月末に）" : "（まだ）"} ›
        </Link>

        <CostPanels
          ym={ym}
          today={today}
          canWrite={canWrite}
          aiReady={aiReady()}
          purchases={purchases}
          losses={losses}
          photos={photos}
          warnIds={warnings.flatMap((w) => w.ids)}
        />

        <section className="notice micro">
          使い方：月締めの業者は<strong>月末の請求書を1枚だけ</strong>。現金・カードの買い物は<strong>レシート</strong>。
          同じ業者の納品書と請求書を両方入れると二重になります（入れたときは上に⚠が出ます）。
          写真はAIが読み、保存は必ず人が確認してから行います。
        </section>
        <div style={{ height: "2rem" }} />
      </div>
    </>
  );
}
