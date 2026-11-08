import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/constants";
import { fmtYen } from "@/lib/sales";
import { lastSunday, TIMING_LABEL } from "@/lib/cost";
import { getStockCounts, getStockItems, getStocktakes } from "@/lib/cost-data";
import { fmtDateShort, shiftDate, todayBizDate } from "@/lib/time";
import StockSheet from "./StockSheet";
import StockStart from "./StockStart";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 棚卸（基本は毎週日曜・店主指示 2026-11-09）。
 *   ?d なし … 新しく数え始める（数えた日＋開店前／閉店後）と、これまでの棚卸の一覧
 *   ?d=as_of … その棚卸の数を入れる。品目と単価は引き継ぐので、毎回は「数」を入れるだけ
 * 空欄＝数えていない（0とは別）。確定した在庫額が、次の区間の始めの在庫になる。
 */
export default async function StockPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const me = await requirePermission("cost.read");
  const sp = await searchParams;
  const today = todayBizDate();
  const canWrite = can(me.role, "cost.write");
  const stocks = await getStocktakes(shiftDate(today, -400));
  const asOf = DATE_RE.test(sp.d ?? "") ? sp.d! : null;
  const cur = asOf ? (stocks.find((s) => s.as_of === asOf) ?? null) : null;

  const header = (title: string, sub: string, back: string) => (
    <header className="appbar">
      <Link className="btn btn-sm" href={back} aria-label="戻る">
        ‹
      </Link>
      <div>
        <div className="appbar__title">{title}</div>
        <div className="appbar__sub">{sub}</div>
      </div>
      <div className="appbar__spacer" />
      <Link className="btn btn-sm" href="/sales/cost">
        原価へ
      </Link>
    </header>
  );

  if (!cur) {
    const draft = stocks.find((s) => s.status === "draft") ?? null;
    return (
      <>
        {header("棚卸", "毎週日曜に数える", "/sales/cost")}
        <div className="wrap stack">
          {asOf ? <p className="notice">その日の棚卸は見つかりませんでした。</p> : null}
          {draft ? (
            <Link className="btn btn-primary btn-block" href={`/sales/cost/stock?d=${draft.as_of}`}>
              数えている途中：{fmtDateShort(draft.counted_on)} {TIMING_LABEL[draft.timing]} ›
            </Link>
          ) : null}
          {canWrite ? <StockStart defaultDate={lastSunday(today)} today={today} /> : null}
          <section className="card" aria-label="これまでの棚卸">
            <h2 className="section-title">これまでの棚卸</h2>
            {stocks.length === 0 ? (
              <p className="micro">まだありません。</p>
            ) : (
              <ul className="cost-list">
                {stocks.map((s) => (
                  <li key={s.as_of} className="cost-row">
                    <Link href={`/sales/cost/stock?d=${s.as_of}`} className="row" style={{ justifyContent: "space-between" }}>
                      <span>
                        {fmtDateShort(s.counted_on)} {TIMING_LABEL[s.timing]}
                      </span>
                      <span>{s.status === "done" && s.total_ex != null ? fmtYen(s.total_ex) : "数えている途中"} ›</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="micro">
            日曜の<strong>開店前</strong>に数えたら土曜の営業まで、<strong>閉店後</strong>なら日曜の営業までの在庫として扱います。
            毎週同じタイミングで数えると、週ごとの原価率がきれいに比べられます。
          </p>
        </div>
      </>
    );
  }

  // 前回＝この棚卸より前の、確定した棚卸
  const prev = stocks.find((s) => s.as_of < cur.as_of && s.status === "done") ?? null;
  const [items, counts, prevCounts] = await Promise.all([
    getStockItems(),
    getStockCounts(cur.as_of),
    prev ? getStockCounts(prev.as_of) : Promise.resolve([]),
  ]);

  return (
    <>
      {header(`${fmtDateShort(cur.counted_on)} ${TIMING_LABEL[cur.timing]}の棚卸`, `${fmtDateShort(cur.as_of)}の営業までの在庫`, "/sales/cost/stock")}
      <StockSheet
        asOf={cur.as_of}
        canWrite={canWrite}
        items={items}
        counts={counts}
        prevQty={Object.fromEntries(prevCounts.map((c) => [c.item_id, c.qty]))}
        status={cur.status}
        total={cur.total_ex}
        prevTotal={prev?.total_ex ?? null}
        prevLabel={prev ? fmtDateShort(prev.counted_on) : null}
      />
    </>
  );
}
