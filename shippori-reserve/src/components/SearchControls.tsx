"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { SELECTABLE_SOURCES } from "@/lib/constants";

const PERIODS = [
  { value: "today", label: "今日" },
  { value: "week", label: "今週" },
  { value: "month", label: "今月" },
  { value: "past", label: "過去90日" },
  { value: "all", label: "すべて" },
];

/** S3 の絞り込み。状態は URL に置く（共有・戻るがそのまま効く）。 */
export default function SearchControls() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  const period = params.get("period") ?? "week";
  const source = params.get("source") ?? "";

  function apply(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.push(`/reservations?${next.toString()}`);
  }

  return (
    <div className="stack" style={{ marginBottom: "0.4rem" }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply({ q });
        }}
      >
        <input
          className="field"
          type="search"
          placeholder="お名前・カナ・電話番号・受付番号で探す"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="フリーワード検索"
        />
      </form>

      <div className="chips">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            className="chip btn-sm"
            aria-pressed={period === p.value}
            onClick={() => apply({ period: p.value })}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="row" style={{ gap: "0.5rem" }}>
        <select
          className="field"
          value={source}
          onChange={(e) => apply({ source: e.target.value })}
          aria-label="流入元でしぼる"
        >
          <option value="">流入元：すべて</option>
          {SELECTABLE_SOURCES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
