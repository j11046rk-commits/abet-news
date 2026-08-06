"use client";

import { useMemo, useState } from "react";
import type { ExclusiveHours } from "@/lib/types";

type Span = "month" | "year" | "all";

const SPANS: { key: Span; ja: string; en: string }[] = [
  { key: "month", ja: "今月", en: "MONTH" },
  { key: "year", ja: "今年", en: "YEAR" },
  { key: "all", ja: "通算", en: "ALL" },
];

/**
 * 利用時間に縛りは無い。罰則も上限も設けない。
 * 誰がどれだけ独占していたかが全員に見えている状態を作るだけの表（SPEC §3-5）。
 * 貸切と通常利用を同じ太さ・同じスケールで併記し、順位番号は振らない。
 */
export default function ExclusiveHoursTable({
  profiles,
  rows,
  thisMonth,
  thisYear,
}: {
  profiles: { id: string; name: string }[];
  rows: ExclusiveHours[];
  thisMonth: string;
  thisYear: string;
}) {
  const [span, setSpan] = useState<Span>("month");

  const data = useMemo(() => {
    const keep = rows.filter((r) =>
      span === "month" ? r.ym === thisMonth : span === "year" ? r.ym.startsWith(thisYear) : true,
    );

    const acc = new Map<string, { exclusive: number; shared: number }>();
    for (const p of profiles) acc.set(p.id, { exclusive: 0, shared: 0 });
    for (const r of keep) {
      const cur = acc.get(r.profile_id) ?? { exclusive: 0, shared: 0 };
      cur.exclusive += r.exclusive_hours;
      cur.shared += r.shared_hours;
      acc.set(r.profile_id, cur);
    }

    const list = profiles.map((p) => ({
      id: p.id,
      name: p.name,
      ...(acc.get(p.id) ?? { exclusive: 0, shared: 0 }),
    }));

    // 多い順に並べる。ただし順位番号は振らない。
    list.sort((a, b) => b.exclusive - a.exclusive || b.shared - a.shared);

    // 全員を同一スケールで測る
    const max = Math.max(1, ...list.map((r) => Math.max(r.exclusive, r.shared)));
    return { list, max };
  }, [rows, profiles, span, thisMonth, thisYear]);

  const label = SPANS.find((s) => s.key === span)?.ja ?? "";

  return (
    <>
      <div className="rule">
        <span className="label">Exclusive hours</span>
      </div>

      <div className="ehead">
        <p className="ehead__title">貸切利用 — {label}</p>
        <div className="ehead__spans">
          {SPANS.map((s) => (
            <button
              key={s.key}
              className={`btn btn-sm${span === s.key ? " is-on" : ""}`}
              onClick={() => setSpan(s.key)}
            >
              {s.ja}
            </button>
          ))}
        </div>
      </div>

      <ul className="ebars">
        {data.list.map((r) => (
          <li key={r.id} className="ebar">
            <span className="ebar__name">{r.name}</span>

            <span className="ebar__track ebar__track--exclusive">
              <span
                className="ebar__fill ebar__fill--exclusive"
                style={{ width: `${(r.exclusive / data.max) * 100}%` }}
              />
            </span>
            <span className="ebar__num amount">{r.exclusive.toFixed(1)} h</span>

            <span className="ebar__track ebar__track--shared">
              <span
                className="ebar__fill ebar__fill--shared"
                style={{ width: `${(r.shared / data.max) * 100}%` }}
              />
            </span>
            <span className="ebar__num amount ebar__num--sub">{r.shared.toFixed(1)} h</span>
          </li>
        ))}
      </ul>

      <p className="micro ebars__key">
        <span className="ebars__swatch ebars__swatch--exclusive" /> 貸切
        <span className="ebars__swatch ebars__swatch--shared" /> 通常利用
      </p>
    </>
  );
}
