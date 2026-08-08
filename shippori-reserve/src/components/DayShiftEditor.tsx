"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateDayShifts } from "@/app/(app)/shifts/actions";
import { chipColors } from "@/lib/staff";

/**
 * 日別画面のシフト手直し。急な休みや交代を、月まるごと組み直さずにその場で直す。
 * 「編集」→チップをタップで入り切り→「保存」。確定済みの月だけ使える。
 */
export default function DayShiftEditor({
  date,
  staff,
  initial,
}: {
  date: string;
  staff: { id: string; name: string; colorIndex: number }[];
  initial: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [ids, setIds] = useState<string[]>(initial);
  const [error, setError] = useState<string | null>(null);

  const save = () =>
    startTransition(async () => {
      const res = await updateDayShifts(date, ids);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setEditing(false);
      router.refresh();
    });

  if (!editing) {
    const onShift = staff.filter((p) => initial.includes(p.id));
    return (
      <div className="chips" style={{ alignItems: "center" }}>
        {onShift.length > 0 ? (
          onShift.map((p) => (
            <span key={p.id} className="shiftchip" style={chipColors(p.colorIndex)}>
              {p.name}
            </span>
          ))
        ) : (
          <span className="micro">この日は誰も入っていません。</span>
        )}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            setIds(initial);
            setError(null);
            setEditing(true);
          }}
        >
          編集
        </button>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: "0.5rem" }}>
      <div className="chips">
        {staff.map((p) => {
          const on = ids.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className="shiftchip shiftchip--btn"
              style={on ? chipColors(p.colorIndex) : undefined}
              aria-pressed={on}
              disabled={pending}
              onClick={() =>
                setIds((prev) =>
                  prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id],
                )
              }
            >
              {p.name}
            </button>
          );
        })}
      </div>
      {error ? <p className="err">{error}</p> : null}
      <div className="row" style={{ gap: "0.4rem" }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={save}>
          {pending ? "保存中" : "この日のシフトを保存"}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={pending}
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
        >
          やめる
        </button>
      </div>
    </div>
  );
}
