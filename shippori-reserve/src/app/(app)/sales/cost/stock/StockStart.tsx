"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StockTiming } from "@/lib/cost";
import { startStocktake } from "../actions";

/** 棚卸を始める：数えた日（初期値は直近の日曜）と、開店前／閉店後 */
export default function StockStart({ defaultDate, today }: { defaultDate: string; today: string }) {
  const router = useRouter();
  const [date, setDate] = useState(defaultDate);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const go = (timing: StockTiming) =>
    start(async () => {
      setErr(null);
      const r = await startStocktake(date, timing);
      if (!r.ok) setErr(r.error);
      else router.push(`/sales/cost/stock?d=${r.asOf}`);
    });
  return (
    <section className="card stack" aria-label="棚卸を始める">
      <h2 className="section-title">棚卸を始める</h2>
      <label className="field-label" htmlFor="st-date">
        数える日
      </label>
      <input id="st-date" className="field" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
      <div className="row">
        <button type="button" className="btn btn-primary" style={{ flex: 1 }} disabled={pending || !date} onClick={() => go("before_open")}>
          開店前に数える
        </button>
        <button type="button" className="btn btn-primary" style={{ flex: 1 }} disabled={pending || !date} onClick={() => go("after_close")}>
          閉店後に数える
        </button>
      </div>
      {err ? <p className="err">{err}</p> : null}
    </section>
  );
}
