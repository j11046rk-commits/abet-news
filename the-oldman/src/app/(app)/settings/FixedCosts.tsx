"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { upsertFixedCost } from "./actions";
import { parseYen, yen } from "@/lib/money";
import type { FixedCost } from "@/lib/types";

const FIXED: { name: string; category: string }[] = [
  { name: "家賃", category: "rent" },
  { name: "共益費", category: "common_fee" },
];

/**
 * 毎月かならず同じ額が出る費目だけを置く。金額と計上日を決めておけば、
 * 計上日が来た日に台帳へ自動で載る（0009 の pg_cron）。押す操作は無い。
 *
 * 水道代・電気代はここに置かない。毎月額が変わるので自動化できず、
 * かわりに未記帳のときだけ台帳の頭で知らせている。
 */
export default function FixedCosts({ costs, isOwner }: { costs: FixedCost[]; isOwner: boolean }) {
  return (
    <>
      <div className="rule">
        <span className="label">Fixed</span>
      </div>

      <p className="dim">
        毎月かかる費用です。<span className="micro">計上日になると台帳に自動で載ります。</span>
      </p>

      <div className="fixedcosts">
        {FIXED.map((f) => (
          <FixedCostRow
            key={f.name}
            cost={costs.find((c) => c.name === f.name)}
            name={f.name}
            category={f.category}
            isOwner={isOwner}
          />
        ))}
      </div>
    </>
  );
}

function FixedCostRow({
  cost,
  name,
  category,
  isOwner,
}: {
  cost: FixedCost | undefined;
  name: string;
  category: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(cost?.amount_yen ?? 0);
  const [day, setDay] = useState(cost?.billing_day ?? 27);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await upsertFixedCost({
      id: cost?.id,
      name,
      category,
      amountYen: amount,
      billingDay: day,
      isActive: true,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setFlash("保存しました");
    router.refresh();
  }

  if (!isOwner) {
    return (
      <p className="fixedcosts__view">
        <span className="fixedcosts__name">{name}</span>
        <span className="fixedcosts__num amount">{yen(cost?.amount_yen ?? 0)}</span>
        <span className="micro">毎月 {cost?.billing_day ?? 27} 日</span>
      </p>
    );
  }

  return (
    <form className="fixedcosts__form" onSubmit={save}>
      <p className="fixedcosts__name">{name}</p>

      {/*
        入力欄には見えるラベルを付ける。読み上げ用の隠しラベルをグリッドに
        直接置いていたため、名前の付いていない子として枠に割り込み、
        金額と計上日と保存ボタンの位置が崩れていた。
      */}
      <div className="fixedcosts__fields">
        <div>
          <label className="field-label" htmlFor={`f-amt-${category}`}>
            金額
          </label>
          <input
            id={`f-amt-${category}`}
            className="field field-num"
            inputMode="numeric"
            pattern="[0-9]*"
            value={amount === 0 ? "" : String(amount)}
            onChange={(e) => setAmount(Math.max(0, parseYen(e.target.value)))}
            placeholder="0"
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`f-day-${category}`}>
            計上日
          </label>
          <input
            id={`f-day-${category}`}
            type="number"
            min={1}
            max={28}
            className="field field-num fixedcosts__day"
            value={day}
            onChange={(e) => setDay(Math.min(28, Math.max(1, Number(e.target.value) || 1)))}
          />
        </div>
        <button type="submit" className="btn btn-sm" disabled={busy}>
          {busy ? "…" : "保存"}
        </button>
      </div>

      <p className="micro fixedcosts__hint">
        毎月 {day} 日に {yen(amount)} を台帳へ自動で載せます。
        {amount === 0 ? "（0円のあいだは載せません）" : ""}
      </p>

      {error ? <p className="err fixedcosts__msg">{error}</p> : null}
      {flash ? <p className="micro fixedcosts__msg">{flash}</p> : null}
    </form>
  );
}
