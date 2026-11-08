"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StockTiming } from "@/lib/cost";
import { startStocktake } from "../actions";

/** 棚卸を始める：数えた日（初期値は直近の日曜）。ふだんは営業中（開店前・閉店後も選べる） */
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
      <button type="button" className="btn btn-primary btn-block" disabled={pending || !date} onClick={() => go("during")}>
        数え始める（営業中の暇なときでOK）
      </button>
      <details className="micro">
        <summary>開店前・閉店後に数えるとき</summary>
        <div className="row" style={{ marginTop: "0.5rem" }}>
          <button type="button" className="btn btn-sm" style={{ flex: 1 }} disabled={pending || !date} onClick={() => go("before_open")}>
            開店前に数えた
          </button>
          <button type="button" className="btn btn-sm" style={{ flex: 1 }} disabled={pending || !date} onClick={() => go("after_close")}>
            閉店後に数えた
          </button>
        </div>
        <p>開店前なら前の日の営業までの在庫として扱います。営業中・閉店後はその日の営業までです。</p>
      </details>
      {err ? <p className="err">{err}</p> : null}
    </section>
  );
}
