"use client";

import { useState } from "react";
import VisitEditor from "@/components/VisitEditor";
import { durationHours, fmtDateJa, fmtTime } from "@/lib/time";
import { purposeMeta, type CheckIn } from "@/lib/types";

/**
 * 直近の滞在。自分の記録は押すと直せる。
 *
 * 他人の記録は押しても開かない — 何時にいたかは本人しか知らないので、
 * 書き換えられる状態にはしない。
 */
export default function Visits({
  visits,
  names,
  meId,
}: {
  visits: CheckIn[];
  names: Record<string, string>;
  meId: string;
}) {
  const [editing, setEditing] = useState<CheckIn | null>(null);

  if (visits.length === 0) return <p className="empty">まだ利用の記録がありません。</p>;

  return (
    <>
      <ul className="visits">
        {visits.map((c) => {
          const mine = c.profile_id === meId;
          const body = (
            <>
              <span className="visits__date mincho">{fmtDateJa(c.checked_in_at)}</span>
              <span className="visits__name">
                {names[c.profile_id] ?? "メンバー"}
                {c.headcount > 1 ? <span className="micro"> {c.headcount}名</span> : null}
              </span>
              <span className="micro visits__what">
                {(c.purposes ?? []).map((p) => purposeMeta(p).ja).join("・")}
              </span>
              <span className="micro amount visits__time">
                {fmtTime(c.checked_in_at)}
                {c.checked_out_at ? `–${fmtTime(c.checked_out_at)}` : "〜"}
              </span>
              <span className="micro visits__dur amount">
                {c.checked_out_at
                  ? `${durationHours(c.checked_in_at, c.checked_out_at)} h`
                  : "滞在中"}
                {/* 本人が押したのか、朝10時の自動締めかを区別する */}
                {c.auto_closed ? <span className="visits__auto">自動</span> : null}
              </span>
            </>
          );

          return (
            <li key={c.id} className="visits__row">
              {mine ? (
                <button className="visits__edit" onClick={() => setEditing(c)}>
                  {body}
                </button>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>

      {editing ? <VisitEditor visit={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
