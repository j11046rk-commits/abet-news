"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleBusy } from "@/app/(app)/calendar/actions";
import { todayBizDate, WEEKDAY_JA } from "@/lib/time";
import type { DailySummary } from "@/lib/types";

const LONG_PRESS_MS = 450;

/**
 * 月グリッド。
 * タップ＝営業日設定へ、長押し＝繁忙日のトグル。
 * 繁忙日の切り替えは月の中で一番多い操作なので、画面を1枚挟まずに済ませる。
 */
export default function CalendarGrid({
  ym,
  days,
  canEdit,
}: {
  ym: string;
  days: DailySummary[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pressed, setPressed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  const today = todayBizDate();

  function start(date: string) {
    if (!canEdit) return;
    longFired.current = false;
    timer.current = setTimeout(() => {
      longFired.current = true;
      setPressed(date);
      startTransition(async () => {
        await toggleBusy(date);
        setPressed(null);
        router.refresh();
      });
    }, LONG_PRESS_MS);
  }

  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function open(date: string) {
    cancel();
    // 長押しが成立していたら、指を離したときの遷移は起こさない
    if (longFired.current) {
      longFired.current = false;
      return;
    }
    router.push(`/calendar/${date}`);
  }

  return (
    <div>
      <div className="cal" aria-hidden>
        {WEEKDAY_JA.map((w) => (
          <div key={w} className="cal__head">
            {w}
          </div>
        ))}
      </div>

      <div className="cal">
        {days.map((d) => {
          const out = !d.biz_date.startsWith(ym);
          const cls = [
            "cal__cell",
            out ? "cal__cell--out" : "",
            d.biz_date === today ? "cal__cell--today" : "",
            d.mode === "event" ? "cal__cell--event" : "",
            d.is_closed ? "cal__cell--closed" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              key={d.biz_date}
              type="button"
              className={cls}
              style={pressed === d.biz_date ? { opacity: 0.5 } : undefined}
              onPointerDown={() => start(d.biz_date)}
              onPointerUp={() => open(d.biz_date)}
              onPointerLeave={cancel}
              onContextMenu={(e) => e.preventDefault()}
              aria-label={`${d.biz_date} ${d.is_closed ? "休業" : d.mode === "event" ? "イベント営業" : "通常営業"} 予約${d.guest_count}名`}
            >
              <span className="cal__day">{Number(d.biz_date.slice(8))}</span>
              {d.is_closed ? (
                <span className="micro">休</span>
              ) : d.guest_count > 0 ? (
                <span className="cal__guests">{d.guest_count}名</span>
              ) : (
                <span className="cal__guests">&nbsp;</span>
              )}
              {d.is_busy ? <span className="cal__busy" aria-label="繁忙日" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
