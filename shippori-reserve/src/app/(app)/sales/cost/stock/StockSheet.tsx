"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmtYen } from "@/lib/sales";
import { stockTotal } from "@/lib/cost";
import type { StockCount, StockItem } from "@/lib/cost-data";
import { deleteStocktake, finishStocktake, reopenStocktake, saveCount, saveStockItem } from "../actions";

type P = {
  asOf: string;
  canWrite: boolean;
  items: StockItem[];
  counts: StockCount[];
  prevQty: Record<string, number>;
  status: "draft" | "done" | null;
  total: number | null;
  prevTotal: number | null;
  /** 前回の棚卸の日（「前回 3」の見出し） */
  prevLabel: string | null;
};

const num = (s: string): number | null => {
  const t = s.normalize("NFKC").replace(/[,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

export default function StockSheet(p: P) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, string>>(
    Object.fromEntries(p.counts.map((c) => [c.item_id, String(c.qty)])),
  );
  const [saved, setSaved] = useState<Record<string, "ok" | "ng">>({});
  const done = p.status === "done";
  const locked = done || !p.canWrite;
  const countPrice = new Map(p.counts.map((c) => [c.item_id, c.unit_price]));

  // 合計は画面で見えている数×（数えた時点の単価、無ければ今の単価）
  const live = stockTotal(
    p.items.map((it) => {
      const n = num(qty[it.id] ?? "");
      return { qty: n != null && !Number.isNaN(n) ? n : null, unit_price: countPrice.get(it.id) ?? it.unit_price };
    }),
  );
  const counted = p.items.filter((it) => (qty[it.id] ?? "") !== "").length;
  const active = p.items.filter((it) => it.active || (qty[it.id] ?? "") !== "");

  const commit = (itemId: string) => {
    const n = num(qty[itemId] ?? "");
    if (Number.isNaN(n)) {
      setSaved({ ...saved, [itemId]: "ng" });
      return;
    }
    start(async () => {
      const r = await saveCount(p.asOf, itemId, n);
      setSaved((s) => ({ ...s, [itemId]: r.ok ? "ok" : "ng" }));
      if (!r.ok) setErr(r.error);
    });
  };

  const finish = () =>
    start(async () => {
      setErr(null);
      const blanks = active.length - counted;
      if (blanks > 0 && !window.confirm(`まだ数えていない品が${blanks}つあります（空欄は在庫に入りません）。確定しますか？`)) return;
      const r = await finishStocktake(p.asOf);
      if (!r.ok) setErr(r.error);
      else router.refresh();
    });

  const reopen = () =>
    start(async () => {
      if (!window.confirm("確定を外して、数を直せるようにしますか？")) return;
      const r = await reopenStocktake(p.asOf);
      if (!r.ok) setErr(r.error);
      else router.refresh();
    });

  const remove = () =>
    start(async () => {
      if (!window.confirm("この棚卸を消しますか？（入れた数も消えます）")) return;
      const r = await deleteStocktake(p.asOf);
      if (!r.ok) setErr(r.error);
      else router.push("/sales/cost/stock");
    });

  return (
    <div className="wrap stack">
      <section className="card cost-sum" aria-label="在庫額">
        <div className="cost-sum__head">
          <span className="cost-sum__label">在庫額（税抜）</span>
          <span className="cost-sum__big">{fmtYen(done && p.total != null ? p.total : live)}</span>
        </div>
        <p className="micro">
          {done ? "確定済み。この額が次の区間の始めの在庫になります。" : `数えた品 ${counted} / ${active.length}　空欄は「数えていない」で、0とは別です。`}
          {p.prevTotal != null ? `　前回（${p.prevLabel}）${fmtYen(p.prevTotal)}` : ""}
        </p>
      </section>

      {p.items.length === 0 ? (
        <p className="notice">
          まだ品目がありません。下の「品目を足す」から、冷蔵庫・冷凍庫・棚にある主な食材と酒を登録してください。
          細かい調味料は「調味料まとめて（単位：円）」のように金額で1行にしてもかまいません。
        </p>
      ) : null}

      <ul className="cost-list">
        {active.map((it) => (
          <li key={it.id} className="cost-row stock-row">
            <div className="stock-row__name">
              {it.name}
              <span className="micro">
                　{fmtYen(countPrice.get(it.id) ?? it.unit_price)}/{it.unit}
                {p.prevQty[it.id] != null ? `　前回 ${p.prevQty[it.id]}` : ""}
              </span>
            </div>
            <div className="row">
              <input
                className="field stock-row__qty"
                inputMode="decimal"
                aria-label={`${it.name}の数`}
                value={qty[it.id] ?? ""}
                disabled={locked}
                placeholder="未"
                onChange={(e) => {
                  setQty({ ...qty, [it.id]: e.target.value });
                  setSaved({ ...saved, [it.id]: undefined as never });
                }}
                onBlur={() => commit(it.id)}
              />
              <span className="micro">{it.unit}</span>
              <span className="micro" aria-live="polite">
                {saved[it.id] === "ok" ? "✓" : saved[it.id] === "ng" ? "×" : ""}
              </span>
            </div>
            {!locked ? <ItemEditor item={it} /> : null}
          </li>
        ))}
      </ul>

      {p.canWrite && !done ? <NewItem /> : null}

      {p.canWrite ? (
        done ? (
          <button type="button" className="btn btn-danger" disabled={pending} onClick={reopen}>
            確定を外す（数を直す）
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-primary btn-block" disabled={pending || counted === 0} onClick={finish}>
              この数で確定する（{fmtYen(live)}）
            </button>
            <button type="button" className="linklike micro" disabled={pending} onClick={remove}>
              この棚卸を消す（日付を間違えたとき）
            </button>
          </>
        )
      ) : null}
      {err ? <p className="err">{err}</p> : null}
      <p className="micro">
        単価は税抜。仕入値が変わったら品目の「単価を直す」で直してください（確定済みの棚卸の在庫額は変わりません）。
      </p>
      <div style={{ height: "2rem" }} />
    </div>
  );
}

function ItemEditor({ item }: { item: StockItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ name: item.name, unit: item.unit, price: String(item.unit_price), category: item.category });
  if (!open) {
    return (
      <button type="button" className="linklike micro" onClick={() => setOpen(true)}>
        単価を直す・使わなくする
      </button>
    );
  }
  const save = (active: boolean) =>
    start(async () => {
      const price = Number(f.price.normalize("NFKC").replace(/[,¥円\s]/g, ""));
      const r = await saveStockItem({ id: item.id, name: f.name, unit: f.unit, unit_price: price, category: f.category, active });
      if (!r.ok) setErr(r.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  return (
    <div className="stack">
      <div className="row">
        <input aria-label="品名" className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input aria-label="単位" className="field" style={{ maxWidth: "4.5rem" }} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />
      </div>
      <div className="row">
        <input aria-label="単価（税抜）" className="field" inputMode="numeric" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        <span className="micro">円/{f.unit}</span>
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => save(true)}>
          保存
        </button>
        <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={() => save(false)}>
          もう使わない（一覧から外す）
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
          閉じる
        </button>
      </div>
      {err ? <p className="err">{err}</p> : null}
    </div>
  );
}

function NewItem() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", unit: "個", price: "", category: "food" as "food" | "drink" });
  if (!open) {
    return (
      <button type="button" className="btn btn-block" onClick={() => setOpen(true)}>
        ＋ 品目を足す
      </button>
    );
  }
  const save = () =>
    start(async () => {
      setErr(null);
      const price = Number(f.price.normalize("NFKC").replace(/[,¥円\s]/g, ""));
      const r = await saveStockItem({ name: f.name, unit: f.unit, unit_price: price, category: f.category });
      if (!r.ok) setErr(r.error);
      else {
        setF({ name: "", unit: f.unit, price: "", category: f.category });
        router.refresh();
      }
    });
  return (
    <section className="card stack" aria-label="品目を足す">
      <label className="field-label" htmlFor="ni-name">品名</label>
      <input id="ni-name" className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="例：生ビール樽 10L" />
      <div className="row">
        <div className="stack" style={{ flex: 1 }}>
          <label className="field-label" htmlFor="ni-price">単価（税抜・円）</label>
          <input id="ni-price" className="field" inputMode="numeric" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        </div>
        <div className="stack" style={{ width: "5rem" }}>
          <label className="field-label" htmlFor="ni-unit">単位</label>
          <input id="ni-unit" className="field" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />
        </div>
      </div>
      <div className="seg">
        <button type="button" className="seg__btn" aria-pressed={f.category === "food"} onClick={() => setF({ ...f, category: "food" })}>
          食材
        </button>
        <button type="button" className="seg__btn" aria-pressed={f.category === "drink"} onClick={() => setF({ ...f, category: "drink" })}>
          酒・飲料
        </button>
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
          足す
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          閉じる
        </button>
      </div>
      {err ? <p className="err">{err}</p> : null}
    </section>
  );
}
