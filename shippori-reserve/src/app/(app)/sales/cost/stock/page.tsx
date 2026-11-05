import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/constants";
import { prevYm } from "@/lib/cost";
import { getStockCounts, getStockItems, getStocktakes } from "@/lib/cost-data";
import { fmtMonthJa, fmtYm, shiftMonth, todayBizDate } from "@/lib/time";
import StockSheet from "./StockSheet";

export const dynamic = "force-dynamic";

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * 月末の棚卸。品目と単価は前の月から引き継ぐので、毎月は「数」を入れるだけ。
 * 空欄＝数えていない（0とは別）。確定した月の合計が、その月末の在庫額＝翌月の月初在庫になる。
 */
export default async function StockPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const me = await requirePermission("cost.read");
  const sp = await searchParams;
  const ym = YM_RE.test(sp.m ?? "") ? sp.m! : fmtYm(todayBizDate());
  const prev = prevYm(ym);

  const [items, counts, prevCounts, stocks] = await Promise.all([
    getStockItems(),
    getStockCounts(ym),
    getStockCounts(prev),
    getStocktakes([prev, ym]),
  ]);

  return (
    <>
      <header className="appbar">
        <Link className="btn btn-sm" href={`/sales/cost/stock?m=${fmtYm(shiftMonth(`${ym}-01`, -1))}`} aria-label="前の月">
          ‹
        </Link>
        <div>
          <div className="appbar__title">{fmtMonthJa(`${ym}-01`)}末 棚卸</div>
          <div className="appbar__sub">在庫を数える</div>
        </div>
        <Link className="btn btn-sm" href={`/sales/cost/stock?m=${fmtYm(shiftMonth(`${ym}-01`, 1))}`} aria-label="次の月">
          ›
        </Link>
        <div className="appbar__spacer" />
        <Link className="btn btn-sm" href={`/sales/cost?m=${ym}`}>
          原価へ
        </Link>
      </header>
      <StockSheet
        ym={ym}
        canWrite={can(me.role, "cost.write")}
        items={items}
        counts={counts}
        prevQty={Object.fromEntries(prevCounts.map((c) => [c.item_id, c.qty]))}
        status={stocks.get(ym)?.status ?? null}
        total={stocks.get(ym)?.total_ex ?? null}
        prevTotal={stocks.get(prev)?.status === "done" ? (stocks.get(prev)?.total_ex ?? null) : null}
      />
    </>
  );
}
