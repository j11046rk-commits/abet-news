"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { SELECTABLE_SOURCES } from "@/lib/constants";
import { surname } from "@/lib/staff";

/**
 * 予約一覧の絞り込み。期間は月固定（ヘッダーの‹ ›で切り替え）なのでここには置かない。
 * 流入元・担当（受付した人）・フリーワード。状態は URL に置く（共有・戻るがそのまま効く）。
 */
export default function SearchControls({
  staffOptions,
}: {
  staffOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  const source = params.get("source") ?? "";
  const staff = params.get("staff") ?? "";

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

        <select
          className="field"
          value={staff}
          onChange={(e) => apply({ staff: e.target.value })}
          aria-label="担当でしぼる"
        >
          <option value="">担当：すべて</option>
          {staffOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {surname(p.name)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
