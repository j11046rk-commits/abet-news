"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EVENT_CLOSE_MIN, EVENT_OPEN_MIN } from "@/lib/constants";
import { minutesToLabel } from "@/lib/time";
import type { BusinessDay } from "@/lib/types";
import type { BusinessDayInput, DayResult } from "@/app/(app)/calendar/actions";

const OPEN_CHOICES = [1020, 1050, 1080, 1110, 1140]; // 17:00〜19:00
const CLOSE_CHOICES = [1380, 1440, 1470, 1500, 1560]; // 23:00〜26:00

export default function BusinessDayForm({
  day,
  guestCount,
  defaultCapacity,
  onSubmit,
}: {
  day: BusinessDay;
  guestCount: number;
  defaultCapacity: number;
  onSubmit: (input: BusinessDayInput) => Promise<DayResult>;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"normal" | "event">(day.mode);
  const [isBusy, setIsBusy] = useState(day.is_busy);
  const [isClosed, setIsClosed] = useState(day.is_closed);
  const [eventName, setEventName] = useState(day.event_name ?? "");
  const [capacity, setCapacity] = useState<number>(day.event_capacity ?? defaultCapacity);
  const [openMin, setOpenMin] = useState(day.open_min);
  const [closeMin, setCloseMin] = useState(day.close_min);
  const [note, setNote] = useState(day.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const switchingToEvent = mode === "event" && day.mode === "normal" && guestCount > 0;

  /**
   * イベント営業は 18:00〜24:00 が既定（店主指定）。切り替えたときに時間も入れ替える。
   * 通常営業に戻したら、その日の元の時間（金土は25:00まで）に戻す。
   */
  function pickMode(next: "normal" | "event") {
    setMode(next);
    if (next === "event") {
      setOpenMin(EVENT_OPEN_MIN);
      setCloseMin(EVENT_CLOSE_MIN);
    } else {
      setOpenMin(day.open_min);
      setCloseMin(day.close_min);
    }
  }

  function submit() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await onSubmit({
        biz_date: day.biz_date,
        mode,
        is_busy: isBusy,
        is_closed: isClosed,
        event_name: eventName,
        event_capacity: mode === "event" ? capacity : null,
        open_min: openMin,
        close_min: closeMin,
        note,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div>
        <label className="field-label">営業モード</label>
        <div className="seg">
          <button
            type="button"
            className="seg__btn"
            aria-pressed={mode === "normal"}
            onClick={() => pickMode("normal")}
          >
            通常営業（しっぽり）
          </button>
          <button
            type="button"
            className="seg__btn"
            aria-pressed={mode === "event"}
            onClick={() => pickMode("event")}
          >
            イベント営業（ビアホール）
          </button>
        </div>
        <p className="micro" style={{ marginTop: "0.4rem" }}>
          {mode === "normal"
            ? "席ごとに管理します。"
            : "相席前提。席は管理せず、定員（総受け入れ人数）だけを見ます。"}
        </p>
      </div>

      {mode === "event" ? (
        <>
          <div>
            <label className="field-label" htmlFor="event_name">
              イベント名
            </label>
            <input
              id="event_name"
              className="field"
              placeholder="例：夏のビアホール"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="capacity">
              定員（総受け入れ人数）<span className="req">必須</span>
            </label>
            <input
              id="capacity"
              type="number"
              inputMode="numeric"
              min={1}
              max={300}
              className="field"
              value={capacity}
              onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))}
            />
            <p className="micro" style={{ marginTop: "0.35rem" }}>
              現在この日には {guestCount} 名の予約が入っています。
            </p>
          </div>

          {switchingToEvent ? (
            <p className="notice notice-strong">
              この日にはすでに {guestCount} 名の予約があります。イベント営業に切り替えると、
              席の欄は使われなくなります（予約そのものは残ります。通常営業に戻せば元どおりです）。
            </p>
          ) : null}
        </>
      ) : null}

      <label className="switch">
        <span>
          繁忙日にする
          <span className="micro" style={{ display: "block" }}>
            席割り当てルール（Phase 2）が参照します
          </span>
        </span>
        <input type="checkbox" checked={isBusy} onChange={(e) => setIsBusy(e.target.checked)} />
      </label>

      <label className="switch">
        <span>
          休業にする
          <span className="micro" style={{ display: "block" }}>
            火曜は既定で休業です
          </span>
        </span>
        <input
          type="checkbox"
          checked={isClosed}
          onChange={(e) => setIsClosed(e.target.checked)}
        />
      </label>

      <div>
        <label className="field-label">営業時間</label>
        <div className="row" style={{ gap: "0.5rem" }}>
          <select
            className="field"
            value={openMin}
            onChange={(e) => setOpenMin(Number(e.target.value))}
            aria-label="開店時刻"
          >
            {OPEN_CHOICES.map((m) => (
              <option key={m} value={m}>
                {minutesToLabel(m)}
              </option>
            ))}
          </select>
          <span className="muted">〜</span>
          <select
            className="field"
            value={closeMin}
            onChange={(e) => setCloseMin(Number(e.target.value))}
            aria-label="閉店時刻"
          >
            {CLOSE_CHOICES.map((m) => (
              <option key={m} value={m}>
                {minutesToLabel(m)}
              </option>
            ))}
          </select>
        </div>
        <p className="micro" style={{ marginTop: "0.35rem" }}>
          既定は 日〜木 18:00〜24:00 ／ 金・土 18:00〜25:00。25:00 は翌日の 1:00 のことです。
        </p>
      </div>

      <div>
        <label className="field-label" htmlFor="note">
          備考（任意）
        </label>
        <input
          id="note"
          className="field"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {error ? <p className="err">{error}</p> : null}

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? "保存中" : saved ? "保存しました" : "保存する"}
      </button>
    </form>
  );
}
