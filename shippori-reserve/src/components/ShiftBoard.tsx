"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleConfirmedShift, toggleMyRequest } from "@/app/(app)/shifts/actions";
import { chipColors } from "@/lib/staff";

export type BoardStaff = { id: string; name: string; colorIndex: number };
export type BoardDay = { date: string; day: number; dowLabel: string; dow: number; closed: boolean };

/**
 * シフト表。
 * - 店長・オーナー（manage）：全員のチップが並ぶ。点線＝希望あり、塗り＝確定。タップで確定を切り替え。
 * - 一般スタッフ（request）：自分のチップだけタップでき、来月分の希望を出す・取り下げる。
 *   他の人の希望・確定も見える（誰がいつ入るかの共有のため）。
 */
export default function ShiftBoard({
  days,
  staff,
  confirmed,
  requests,
  mode,
  myId,
  requestOpen,
}: {
  days: BoardDay[];
  staff: BoardStaff[];
  confirmed: Record<string, string[]>;
  requests: Record<string, string[]>;
  mode: "manage" | "request" | "view";
  myId: string;
  /** request モードで、この月の希望をいま出せるか */
  requestOpen: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "変更できませんでした。");
        return;
      }
      setError(null);
      router.refresh();
    });

  function chipState(date: string, id: string): "confirmed" | "requested" | "none" {
    if ((confirmed[date] ?? []).includes(id)) return "confirmed";
    if ((requests[date] ?? []).includes(id)) return "requested";
    return "none";
  }

  const clickable = (id: string) =>
    mode === "manage" || (mode === "request" && id === myId && requestOpen);

  function onChip(date: string, id: string) {
    if (mode === "manage") run(() => toggleConfirmedShift(date, id));
    else if (mode === "request" && id === myId) run(() => toggleMyRequest(date));
  }

  return (
    <div className="shiftboard">
      {error ? <p className="err">{error}</p> : null}

      {days.map((d) => (
        <div key={d.date} className={`srow ${d.closed ? "srow--closed" : ""}`}>
          <div className="srow__date">
            <span className="mrow__day">{d.day}</span>
            <span
              className={`mrow__dow ${d.dow === 0 ? "mrow__dow--sun" : d.dow === 6 ? "mrow__dow--sat" : ""}`}
            >
              {d.dowLabel}
            </span>
          </div>
          <div className="srow__chips">
            {d.closed ? (
              <span className="micro">休業日</span>
            ) : (
              staff.map((p) => {
                const state = chipState(d.date, p.id);
                const colors = chipColors(p.colorIndex);
                const style =
                  state === "confirmed"
                    ? colors
                    : state === "requested"
                      ? {
                          borderColor: colors.borderColor,
                          borderStyle: "dashed" as const,
                          color: "var(--text)",
                        }
                      : undefined;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="shiftchip shiftchip--btn"
                    style={style}
                    aria-pressed={state === "confirmed"}
                    disabled={pending || !clickable(p.id)}
                    onClick={() => onChip(d.date, p.id)}
                  >
                    {p.name}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
