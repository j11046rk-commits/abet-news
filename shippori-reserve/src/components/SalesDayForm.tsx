"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSalesDay } from "@/app/(app)/sales/actions";
import type { SalesDay } from "@/lib/sales";

/**
 * 営業日の設定にある売上（目標・実績）の手入力。店長・オーナーのみ。
 * 実績は普段エアレジ（週次レポート）から自動で入るので、ここは目標入力と手直し用。
 */
export default function SalesDayForm({ date, sales }: { date: string; sales: SalesDay | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState(sales?.target_yen?.toString() ?? "");
  const [actual, setActual] = useState(sales?.actual_yen?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parse = (v: string): number | null => {
    const t = v.trim().replaceAll(",", "");
    if (t === "") return null;
    const n = Number(t);
    return Number.isInteger(n) && n >= 0 ? n : NaN;
  };

  function submit() {
    setError(null);
    setSaved(false);
    const t = parse(target);
    const a = parse(actual);
    if (Number.isNaN(t) || Number.isNaN(a)) {
      setError("金額は0以上の整数で入れてください。");
      return;
    }
    startTransition(async () => {
      const res = await setSalesDay(date, t, a);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <section className="card">
      <p className="micro" style={{ letterSpacing: "0.12em", margin: "0 0 0.5rem" }}>
        この日の売上
      </p>
      <div className="row" style={{ gap: "0.5rem", alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <label className="field-label" htmlFor="sales-target">
            目標（円）
          </label>
          <input
            id="sales-target"
            className="field"
            type="text"
            inputMode="numeric"
            placeholder="例: 50000"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label" htmlFor="sales-actual">
            実績（円）
          </label>
          <input
            id="sales-actual"
            className="field"
            type="text"
            inputMode="numeric"
            placeholder="自動取込あり"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
          />
        </div>
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={submit}>
          {pending ? "保存中" : "保存"}
        </button>
      </div>
      {error ? <p className="err">{error}</p> : null}
      {saved ? (
        <p className="micro" style={{ color: "var(--ok)", margin: "0.35rem 0 0" }}>
          保存しました。カレンダーと売上タブに反映されます。
        </p>
      ) : null}
      <p className="micro" style={{ margin: "0.35rem 0 0" }}>
        空欄は「変更しない」。実績はエアレジ（週次レポート）からの自動取り込みが基本です。
      </p>
    </section>
  );
}
