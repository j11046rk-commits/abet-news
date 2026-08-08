"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmMonthShifts, submitMyRequests } from "@/app/(app)/shifts/actions";
import { chipColors } from "@/lib/staff";

export type BoardStaff = { id: string; name: string; colorIndex: number };
export type BoardDay = { date: string; day: number; dowLabel: string; dow: number; closed: boolean };

// 端末のタイムゾーンではなく日本時間で出す（サーバー描画とクライアントで表示が食い違わないように）
const stampFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const fmtStamp = (iso: string) => stampFmt.format(new Date(iso));

/**
 * シフト表。編集は手元（下書き）で行い、ボタンで一括保存する。
 * - request（一般スタッフ）：月のカレンダーに自分の入れる日をチェック →「希望シフトを提出」。
 *   他の人の名前は出さない（自分のことだけ決めればよい画面にする）。
 * - manage（店長・オーナー）：希望（点線）を見ながらタップで下書き →「シフトを確定」。
 *   確定して初めて暦に表示される。出勤日数は上に固定表示され、タップのたびに動く。
 */
export default function ShiftBoard({
  ym,
  days,
  staff,
  confirmedInit,
  requests,
  submissions,
  submitterIds,
  mySubmittedAt,
  publishedAt,
  mode,
  myId,
  requestOpen,
}: {
  ym: string;
  days: BoardDay[];
  staff: BoardStaff[];
  /** 確定シフトの初期値（未確定月で空なら、店長のデフォルト出勤を入れた下書き） */
  confirmedInit: Record<string, string[]>;
  requests: Record<string, string[]>;
  /** profile_id → 提出日時 */
  submissions: Record<string, string>;
  /** 希望を提出する側（一般スタッフ）のID。「希望の提出」欄はこの人たちだけ出す */
  submitterIds: string[];
  mySubmittedAt: string | null;
  publishedAt: string | null;
  mode: "manage" | "request" | "view";
  myId: string;
  requestOpen: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // 出勤日数バーはアプリバーのすぐ下に貼り付く。アプリバーは副題の折り返しや
  // 文字サイズ設定で高さが変わるので、決め打ちせず実測して合わせる。
  const countbarRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const bar = countbarRef.current;
    const appbar = document.querySelector<HTMLElement>(".appbar");
    if (!bar || !appbar) return;
    const apply = () => {
      bar.style.top = `${appbar.offsetHeight}px`;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(appbar);
    return () => ro.disconnect();
  }, []);

  // ── 下書き ──
  const [draft, setDraft] = useState<Record<string, string[]>>(confirmedInit);
  const [myDays, setMyDays] = useState<Set<string>>(
    () => new Set(days.filter((d) => (requests[d.date] ?? []).includes(myId)).map((d) => d.date)),
  );

  /** 出勤日数（下書きベース・リアルタイム） */
  const counts = useMemo(() => {
    const c = new Map<string, number>(staff.map((p) => [p.id, 0]));
    for (const list of Object.values(draft)) {
      for (const id of list) c.set(id, (c.get(id) ?? 0) + 1);
    }
    return c;
  }, [draft, staff]);

  function toggleDraft(date: string, id: string) {
    setSaved(null);
    setDraft((prev) => {
      const list = prev[date] ?? [];
      return {
        ...prev,
        [date]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
      };
    });
  }

  function toggleMyDay(date: string) {
    setSaved(null);
    setMyDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, doneMsg: string) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "保存できませんでした。");
        return;
      }
      setError(null);
      setSaved(doneMsg);
      router.refresh();
    });

  // ─────────────────────────────────────────────
  // 一般スタッフ：月カレンダーにチェック → 提出
  // ─────────────────────────────────────────────
  if (mode === "request") {
    const lead = days.length > 0 ? days[0].dow : 0;

    return (
      <div className="stack">
        <div className="sgrid" role="grid" aria-label="希望シフト">
          {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
            <div key={w} className="sgrid__head">
              {w}
            </div>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <div key={`pad-${i}`} />
          ))}
          {days.map((d) => {
            const on = myDays.has(d.date);
            return (
              <button
                key={d.date}
                type="button"
                className={`scell ${d.closed ? "scell--closed" : on ? "scell--ok" : "scell--ng"}`}
                aria-pressed={on}
                aria-label={`${d.day}日 ${d.closed ? "休業日" : on ? "出勤可" : "出勤不可"}`}
                disabled={pending || d.closed || !requestOpen}
                onClick={() => toggleMyDay(d.date)}
              >
                <span className="scell__day">{d.day}</span>
                <span className="scell__mark">{d.closed ? "休" : on ? "◯" : "×"}</span>
              </button>
            );
          })}
        </div>

        <p className="micro" style={{ textAlign: "center" }}>
          ◯（出勤できる日）{myDays.size} 日
          {mySubmittedAt ? `｜前回の提出 ${fmtStamp(mySubmittedAt)}` : "｜まだ提出していません"}
        </p>

        {error ? <p className="err">{error}</p> : null}
        {saved ? <p className="micro" style={{ color: "var(--ok)", textAlign: "center" }}>{saved}</p> : null}

        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={pending || !requestOpen}
          onClick={() => run(() => submitMyRequests(ym, [...myDays]), "希望シフトを提出しました。")}
        >
          {pending ? "提出中" : mySubmittedAt ? "希望シフトを出し直す" : "希望シフトを提出する"}
        </button>
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // 店長・オーナー：下書きを組む → 確定
  // ─────────────────────────────────────────────
  return (
    <div className="stack">
      {/* 出勤日数。スクロールしても常に見える。 */}
      <div className="countbar" ref={countbarRef}>
        {staff.map((p) => (
          <span key={p.id} className="shiftchip" style={chipColors(p.colorIndex)}>
            {p.name} {counts.get(p.id) ?? 0}
          </span>
        ))}
      </div>

      <p className="micro">
        希望の提出：
        {staff
          .filter((p) => submitterIds.includes(p.id))
          .map((p) => `${p.name}${submissions[p.id] ? "✓" : "—"}`)
          .join("　")}
      </p>

      <div className="shiftboard">
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
                  const on = (draft[d.date] ?? []).includes(p.id);
                  const requested = (requests[d.date] ?? []).includes(p.id);
                  const colors = chipColors(p.colorIndex);
                  const style = on
                    ? colors
                    : requested
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
                      aria-pressed={on}
                      disabled={pending || mode === "view"}
                      onClick={() => toggleDraft(d.date, p.id)}
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

      {error ? <p className="err">{error}</p> : null}
      {saved ? <p className="micro" style={{ color: "var(--ok)", textAlign: "center" }}>{saved}</p> : null}

      {mode === "manage" ? (
        <div className="confirmbar">
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  confirmMonthShifts(
                    ym,
                    Object.entries(draft).flatMap(([date, ids]) =>
                      ids.map((profile_id) => ({ date, profile_id })),
                    ),
                  ),
                "シフトを確定しました。暦に表示されます。",
              )
            }
          >
            {pending ? "確定中" : publishedAt ? "シフトを確定し直す" : "シフトを確定する"}
          </button>
          <p className="micro" style={{ textAlign: "center", margin: "0.3rem 0 0" }}>
            {publishedAt
              ? `確定済み（${fmtStamp(publishedAt)}）。押し直すと上書きされます。`
              : "確定すると暦と日別画面に表示されます。"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
