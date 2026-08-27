"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { setDirty } from "@/lib/dirty";
import { useRouter } from "next/navigation";
import { confirmMonthShifts, submitMyRequests } from "@/app/(app)/shifts/actions";
import { isHoliday } from "@/lib/holidays";
import { chipColors } from "@/lib/staff";
import {
  closeMinOf,
  isDefaultTime,
  resolveShiftTime,
  shiftTimeLabel,
  type ShiftDefault,
} from "@/lib/shift-time";
import type { ShiftTimeRow } from "@/lib/types";
import ShiftTimeBar, { ShiftHourStrip, type ShiftBarEntry } from "@/components/ShiftTimeBar";

export type BoardStaff = { id: string; name: string; colorIndex: number };
export type BoardDay = {
  date: string;
  day: number;
  dowLabel: string;
  dow: number;
  closed: boolean;
  /** その日の閉店時刻（LAST の表示に使う） */
  closeMin: number;
};

/** 時間を選ぶ候補。18:00〜22:00 を30分刻み（それ以降から入る運用は無い） */
const START_CHOICES = [1080, 1110, 1140, 1170, 1200, 1230, 1260, 1290, 1320];
/** 終わりの候補。null＝LAST（その日の閉店まで） */
const END_CHOICES: (number | null)[] = [null, 1200, 1230, 1260, 1290, 1320, 1380, 1440, 1500];

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

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
  myDefault,
  times,
  confirmedTimes,
  defaults,
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
  /** 自分の基本の出勤時間。start が null なら時間を持たない人（店長） */
  myDefault: ShiftDefault | null;
  /** すでに入っている時間（`${date}|${profile_id}` → 時間） */
  times: Record<string, ShiftTimeRow>;
  /** 確定シフトの時間（`${date}|${profile_id}` → 時間）。スタッフ向けのタイムバー表示に使う */
  confirmedTimes: Record<string, ShiftTimeRow>;
  /** 全員の基本の時間（profile_id → 基本） */
  defaults: Record<string, ShiftDefault>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // 出勤日数バーはアプリバーのすぐ下に貼り付く。アプリバーは副題の折り返しや
  // 文字サイズ設定で高さが変わるので、決め打ちせず実測して合わせる。
  useEffect(() => () => setDirty(false), []);

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

  /*
   * 時間の下書き。日付 → その日の時間。入っていない日は「基本のとおり」。
   *
   * ◯を押しただけの日には何も入らない——それが「基本のとおり」の意味なので、
   * わざわざ基本の時刻を書き込まない。あとで基本を変えたときに、
   * 書き込んだ古い時刻が残り続けるのを避けるため。
   */
  const [timeDraft, setTimeDraft] = useState<Record<string, ShiftTimeRow>>(() => {
    const out: Record<string, ShiftTimeRow> = {};
    for (const d of days) {
      const t = times[`${d.date}|${myId}`];
      if (t && t.start_min != null) out[d.date] = t;
    }
    return out;
  });
  const [timeOpen, setTimeOpen] = useState(false);

  /** 自分は時間の概念を持つ人か（店長・オーナーは持たない） */
  const hasTime = !!myDefault && myDefault.default_start_min != null;

  function setDayTime(date: string, next: ShiftTimeRow | null) {
    setSaved(null);
    setDirty(true);
    setTimeDraft((prev) => {
      const copy = { ...prev };
      if (next === null) delete copy[date];
      else copy[date] = next;
      return copy;
    });
  }

  // 休業日。確定したあとで臨時休業にした日は、その日のチップが画面から消えるので
  // 店長が外せない。数える側・保存する側で外しておかないと、
  // 「休」の日の出勤が出勤日数に混ざったまま確定し直されてしまう。
  const closedDates = useMemo(
    () => new Set(days.filter((d) => d.closed).map((d) => d.date)),
    [days],
  );

  /** 出勤日数（下書きベース・リアルタイム）。休業日は数えない。 */
  const counts = useMemo(() => {
    const c = new Map<string, number>(staff.map((p) => [p.id, 0]));
    for (const [date, list] of Object.entries(draft)) {
      if (closedDates.has(date)) continue;
      for (const id of list) c.set(id, (c.get(id) ?? 0) + 1);
    }
    return c;
  }, [draft, staff, closedDates]);

  function toggleDraft(date: string, id: string) {
    setSaved(null);
    setDirty(true);
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
    setDirty(true);
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
      setDirty(false);
      router.refresh();
    });

  /*
   * 確定シフトを 17〜25時のタイムバーに直す（店主要望 2026-08-28）。
   * スタッフが「自分は何時から・誰と一緒か・薄い時間帯はどこか」を
   * 名前の並びではなく帯で読めるようにする。
   */
  const confirmedEntriesOf = (d: BoardDay): ShiftBarEntry[] =>
    (confirmedInit[d.date] ?? []).flatMap((id) => {
      const p = staff.find((x) => x.id === id);
      if (!p) return [];
      const t = resolveShiftTime(confirmedTimes[`${d.date}|${id}`] ?? null, defaults[id] ?? null);
      if (!t) return [{ name: p.name, colorIndex: p.colorIndex, start: 1020, end: 1500, wholeDay: true }];
      return [{ name: p.name, colorIndex: p.colorIndex, start: t.start, end: t.end ?? d.closeMin }];
    });
  const confirmedBarDays = publishedAt
    ? days.filter((d) => !d.closed && (confirmedInit[d.date] ?? []).length > 0)
    : [];

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

        {/*
          時間は「基本」で入るので、ふつうは触らなくていい。
          触る必要がある日だけ開いて直す——◯を押す速さを落とさないために、
          畳んだ状態から始める（店主指示：提出の簡単さは今のまま）。
        */}
        {hasTime ? (
          <section className="card" style={{ padding: "0.7rem 0.9rem" }}>
            <p className="micro" style={{ margin: 0 }}>
              ◯の日は <strong>
                {shiftTimeLabel(resolveShiftTime(null, myDefault), null)}
              </strong> で入ります。
            </p>
            {myDays.size > 0 ? (
              <button
                type="button"
                className="linklike"
                style={{ marginTop: "0.4rem" }}
                onClick={() => setTimeOpen((v) => !v)}
              >
                {timeOpen ? "閉じる" : `時間が違う日を直す${
                  Object.keys(timeDraft).length > 0 ? `（${Object.keys(timeDraft).length}日）` : ""
                }`}
              </button>
            ) : null}

            {timeOpen ? (
              <div className="stack" style={{ gap: "0.5rem", marginTop: "0.6rem" }}>
                {days
                  .filter((d) => myDays.has(d.date) && !d.closed)
                  .map((d) => {
                    const row = timeDraft[d.date] ?? null;
                    const t = resolveShiftTime(row, myDefault);
                    const custom = !isDefaultTime(row, myDefault);
                    return (
                      <div key={d.date} className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                        <span style={{ minWidth: "3.6rem", fontVariantNumeric: "tabular-nums" }}>
                          {d.day}日({d.dowLabel})
                        </span>
                        <select
                          className="field"
                          style={{ width: "auto" }}
                          value={t?.start ?? ""}
                          aria-label={`${d.day}日の出勤時刻`}
                          onChange={(e) =>
                            setDayTime(d.date, {
                              start_min: Number(e.target.value),
                              end_min: row ? row.end_min : (myDefault?.default_end_min ?? null),
                            })
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
                          aria-label={`${d.day}日の退勤時刻`}
                          onChange={(e) =>
                            setDayTime(d.date, {
                              start_min: t?.start ?? myDefault?.default_start_min ?? 1080,
                              end_min: e.target.value === "last" ? null : Number(e.target.value),
                            })
                          }
                        >
                          {END_CHOICES.map((m) => (
                            <option key={m ?? "last"} value={m ?? "last"}>
                              {m === null ? `LAST（${hhmm(d.closeMin)}）` : hhmm(m)}
                            </option>
                          ))}
                        </select>
                        {custom ? (
                          <button
                            type="button"
                            className="linklike"
                            onClick={() => setDayTime(d.date, null)}
                          >
                            基本に戻す
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                <p className="micro" style={{ margin: 0 }}>
                  直した日だけ記録します。触らなかった日は基本のままです。
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        {error ? <p className="err">{error}</p> : null}
        {saved ? <p className="micro" style={{ color: "var(--ok)", textAlign: "center" }}>{saved}</p> : null}

        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={pending || !requestOpen}
          onClick={() =>
            run(
              // 提出後に休業日になった日は落とす（画面では「休」で押せないのに残っているため）
              () =>
                submitMyRequests(
                  ym,
                  [...myDays]
                    .filter((d) => !closedDates.has(d))
                    .map((date) => ({
                      date,
                      start_min: timeDraft[date]?.start_min ?? null,
                      end_min: timeDraft[date]?.end_min ?? null,
                    })),
                ),
              "希望シフトを提出しました。",
            )
          }
        >
          {pending ? "提出中" : mySubmittedAt ? "希望シフトを出し直す" : "希望シフトを提出する"}
        </button>

        {/*
          確定済みのシフトをタイムバーで（店主要望 2026-08-28）。
          自分が何時から・誰と一緒か・薄い時間帯はどこかを帯で読める。
          未確定の月では出さない（希望の提出画面を邪魔しない）。
        */}
        {confirmedBarDays.length > 0 ? (
          <section className="card" style={{ padding: "0.7rem 0.9rem" }}>
            <p className="micro" style={{ letterSpacing: "0.12em", margin: 0 }}>
              確定シフト（{fmtStamp(publishedAt!)} 確定）
            </p>
            {confirmedBarDays.map((d) => (
              <div key={d.date} style={{ marginTop: "0.7rem" }}>
                <p className="micro" style={{ margin: "0 0 0.1rem", fontVariantNumeric: "tabular-nums" }}>
                  <span className={d.dow === 0 || isHoliday(d.date) ? "mrow__dow--sun" : d.dow === 6 ? "mrow__dow--sat" : ""}>
                    {d.day}日（{d.dowLabel}）
                  </span>
                </p>
                <ShiftTimeBar entries={confirmedEntriesOf(d)} note={false} />
              </div>
            ))}
            <p className="shiftbar__note" style={{ marginLeft: 0 }}>
              数字＝その時間帯の人数。時間なしの人（店長）は通し扱い。
            </p>
          </section>
        ) : null}
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
        {days.map((d) => {
          /*
           * その日の下書きを 17〜25時の人数に直す（タップのたびに動く）。
           * 名前の並びだけでは「21時台が1人」に気づけない——組みながら見えるのが肝。
           * 時間を持たない人（店長・オーナー）は通し扱い。
           */
          const strip: ShiftBarEntry[] = d.closed
            ? []
            : (draft[d.date] ?? []).flatMap((id) => {
                const p = staff.find((s) => s.id === id);
                if (!p) return [];
                const t = resolveShiftTime(times[`${d.date}|${id}`] ?? null, defaults[id] ?? null);
                if (!t) return [{ name: p.name, colorIndex: p.colorIndex, start: 1020, end: 1500, wholeDay: true }];
                return [{ name: p.name, colorIndex: p.colorIndex, start: t.start, end: t.end ?? d.closeMin }];
              });
          return (
          <div key={d.date} className={`srow ${d.closed ? "srow--closed" : ""}`}>
            <div className="srow__date">
              <span className="mrow__day">{d.day}</span>
              <span
                className={`mrow__dow ${d.dow === 0 || isHoliday(d.date) ? "mrow__dow--sun" : d.dow === 6 ? "mrow__dow--sat" : ""}`}
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
              {strip.length > 0 ? <ShiftHourStrip entries={strip} /> : null}
            </div>
          </div>
          );
        })}
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
                    Object.entries(draft)
                      .filter(([date]) => !closedDates.has(date))
                      .flatMap(([date, ids]) =>
                        ids.map((profile_id) => {
                          // 本人が希望で時間を直していれば、その時間のまま確定する。
                          // 直していない日は空のまま——「基本のとおり」の意味を保つ。
                          const t = times[`${date}|${profile_id}`];
                          return {
                            date,
                            profile_id,
                            start_min: t?.start_min ?? null,
                            end_min: t?.end_min ?? null,
                          };
                        }),
                      ),
                  ),
                "シフトを確定しました。カレンダーに表示されます。",
              )
            }
          >
            {pending ? "確定中" : publishedAt ? "シフトを確定し直す" : "シフトを確定する"}
          </button>
          <p className="micro" style={{ textAlign: "center", margin: "0.3rem 0 0" }}>
            {publishedAt
              ? `確定済み（${fmtStamp(publishedAt)}）。押し直すと上書きされます。`
              : "確定するとカレンダーと日別画面に表示されます。"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
