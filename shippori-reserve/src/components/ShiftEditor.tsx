"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleShift } from "@/app/(app)/day/actions";
import { chipColors } from "@/lib/staff";

export type ShiftStaff = {
  id: string;
  name: string; // チップに載せる短い名前
  colorIndex: number;
  on: boolean;
};

/**
 * その日のシフト。名前チップをタップして入れる／外す。
 * 表を別に作らせない——予約と同じ画面の同じ日に置くことが、この機能の全部。
 */
export default function ShiftEditor({
  date,
  staff,
  canEdit,
}: {
  date: string;
  staff: ShiftStaff[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <section className="card">
      <p className="micro" style={{ letterSpacing: "0.12em", marginBottom: "0.5rem" }}>
        この日のシフト{canEdit ? "（タップで入れる・外す）" : ""}
      </p>
      <div className="chips">
        {staff.map((p) => (
          <button
            key={p.id}
            type="button"
            className="shiftchip shiftchip--btn"
            style={p.on ? chipColors(p.colorIndex) : undefined}
            aria-pressed={p.on}
            disabled={pending || !canEdit}
            onClick={() =>
              startTransition(async () => {
                await toggleShift(date, p.id);
                router.refresh();
              })
            }
          >
            {p.name}
          </button>
        ))}
      </div>
    </section>
  );
}
