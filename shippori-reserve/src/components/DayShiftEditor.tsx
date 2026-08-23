"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateDayShifts } from "@/app/(app)/shifts/actions";
import { chipColors } from "@/lib/staff";
import {
  isDefaultTime,
  resolveShiftTime,
  shiftTimeLabel,
  type ShiftDefault,
} from "@/lib/shift-time";
import type { ShiftTimeRow } from "@/lib/types";

export type DayShiftStaff = {
  id: string;
  name: string;
  colorIndex: number;
  /** 基本の出勤時間。start が null ＝ 時間を持たない人（店長） */
  def: ShiftDefault;
};

/** 時間を選ぶ候補。18:00〜22:00 を30分刻み */
const START_CHOICES = [1080, 1110, 1140, 1170, 1200, 1230, 1260, 1290, 1320];
/** 終わりの候補。null＝LAST（その日の閉店まで） */
const END_CHOICES: (number | null)[] = [null, 1200, 1230, 1260, 1290, 1320, 1380, 1440, 1500];

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * 日別画面のシフト手直し。急な休みや交代を、月まるごと組み直さずにその場で直す。
 * 「編集」→チップをタップで入り切り→ 時間も直せる →「保存」。確定済みの月だけ使える。
 *
 * 時間をここで直せるようにしたのは、当日の調整（「その日は20時から」）が
 * 一番よく起きるのがこの画面だから。月のグリッドに時間を詰め込むより、
 * 日を開いて直すほうが指も目も迷わない。
 */
export default function DayShiftEditor({
  date,
  closeMin,
  staff,
  initial,
  initialTimes,
}: {
  date: string;
  /** その日の閉店時刻。LAST の表示に使う */
  closeMin: number;
  staff: DayShiftStaff[];
  initial: string[];
  /** profile_id → その日の時間（入っていなければ基本のとおり） */
  initialTimes: Record<string, ShiftTimeRow>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [ids, setIds] = useState<string[]>(initial);
  const [times, setTimes] = useState<Record<string, ShiftTimeRow>>(initialTimes);
  const [error, setError] = useState<string | null>(null);

  const defOf = (id: string): ShiftDefault =>
    staff.find((p) => p.id === id)?.def ?? { default_start_min: null, default_end_min: null };

  const save = () =>
    startTransition(async () => {
      const res = await updateDayShifts(
        date,
        ids.map((profile_id) => ({
          profile_id,
          start_min: times[profile_id]?.start_min ?? null,
          end_min: times[profile_id]?.end_min ?? null,
        })),
      );
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
          onShift.map((p) => {
            const t = resolveShiftTime(initialTimes[p.id] ?? null, p.def);
            return (
              <span key={p.id} className="shiftchip" style={chipColors(p.colorIndex)}>
                {p.name}
                {t ? (
                  <span className="shiftchip__time"> {shiftTimeLabel(t, closeMin)}</span>
                ) : null}
              </span>
            );
          })
        ) : (
          <span className="micro">この日は誰も入っていません。</span>
        )}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            setIds(initial);
            setTimes(initialTimes);
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

      {/* 入っている人の時間。基本のままの人は触らなくていい */}
      {staff
        .filter((p) => ids.includes(p.id) && p.def.default_start_min != null)
        .map((p) => {
          const row = times[p.id] ?? null;
          const t = resolveShiftTime(row, p.def);
          const custom = !isDefaultTime(row, p.def);
          return (
            <div key={p.id} className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
              <span style={{ minWidth: "3.4rem" }}>{p.name}</span>
              <select
                className="field"
                style={{ width: "auto" }}
                value={t?.start ?? ""}
                aria-label={`${p.name} の出勤時刻`}
                disabled={pending}
                onChange={(e) =>
                  setTimes((prev) => ({
                    ...prev,
                    [p.id]: {
                      start_min: Number(e.target.value),
                      end_min: row ? row.end_min : p.def.default_end_min,
                    },
                  }))
                }
              >
                {START_CHOICES.map((m) => (
                  <option key={m} value={m}>
                    {hhmm(m)}
                  </option>
                ))}
              </select>
              <span>〜</span>
              <select
                className="field"
                style={{ width: "auto" }}
                value={t?.end ?? "last"}
                aria-label={`${p.name} の退勤時刻`}
                disabled={pending}
                onChange={(e) =>
                  setTimes((prev) => ({
                    ...prev,
                    [p.id]: {
                      start_min: t?.start ?? p.def.default_start_min ?? 1080,
                      end_min: e.target.value === "last" ? null : Number(e.target.value),
                    },
                  }))
                }
              >
                {END_CHOICES.map((m) => (
                  <option key={m ?? "last"} value={m ?? "last"}>
                    {m === null ? `LAST（${hhmm(closeMin)}）` : hhmm(m)}
                  </option>
                ))}
              </select>
              {custom ? (
                <button
                  type="button"
                  className="linklike"
                  disabled={pending}
                  onClick={() =>
                    setTimes((prev) => {
                      const copy = { ...prev };
                      delete copy[p.id];
                      return copy;
                    })
                  }
                >
                  基本に戻す
                </button>
              ) : null}
            </div>
          );
        })}

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
