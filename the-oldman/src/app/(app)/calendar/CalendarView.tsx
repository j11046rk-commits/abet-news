"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import ReservationForm from "@/components/ReservationForm";
import { addDaysJst, fmt, fmtDate, fmtDateJa, fmtTime, jstHourToIso, nowJst, startOfMonthJst, startOfWeekJst } from "@/lib/time";
import VisitEditor from "@/components/VisitEditor";
import { purposeMeta, type CheckIn, type Reservation } from "@/lib/types";

const ROW = 34; // 1時間の高さ(px)

type Segment = {
  r: Reservation;
  fromHour: number; // 0..23
  toHour: number; // 1..24
  lane: number;
  lanes: number;
  continues: boolean; // 翌日に続く
};

/** 滞在の1本。予約と同じ時間軸に、細い帯として並べる。 */
type VisitSeg = { c: CheckIn; fromHour: number; toHour: number };

/**
 * その日にかかる滞在を切り出す。
 *
 * 予約は「これから使う約束」、滞在は「実際にいた記録」。別の物なので、
 * レーンを共有せず、列の左端の細い帯にまとめて出す。
 */
function visitsForDay(visits: CheckIn[], date: string): VisitSeg[] {
  const dayStart = new Date(jstHourToIso(date, 0)).getTime();
  const dayEnd = new Date(jstHourToIso(date, 24)).getTime();
  const now = Date.now();

  return visits
    .map((c) => {
      const s = new Date(c.checked_in_at).getTime();
      const e = c.checked_out_at ? new Date(c.checked_out_at).getTime() : now;
      if (e <= dayStart || s >= dayEnd) return null;
      return {
        c,
        fromHour: Math.max(0, (Math.max(s, dayStart) - dayStart) / 3600_000),
        toHour: Math.min(24, (Math.min(e, dayEnd) - dayStart) / 3600_000),
      };
    })
    .filter((x): x is VisitSeg => x !== null)
    .sort((a, b) => a.fromHour - b.fromHour);
}

const dayKey = (d: Date) => fmtDate(d);
const parseJstDate = (s: string) => new Date(`${s}T00:00:00+09:00`);

/** その日に重なる予約を、日内のセグメントに切り出す */
function segmentsForDay(reservations: Reservation[], date: string): Segment[] {
  const dayStart = new Date(jstHourToIso(date, 0)).getTime();
  const dayEnd = new Date(jstHourToIso(date, 24)).getTime();

  const raw = reservations
    .map((r) => {
      const s = new Date(r.starts_at).getTime();
      const e = new Date(r.ends_at).getTime();
      if (e <= dayStart || s >= dayEnd) return null;
      const from = Math.max(s, dayStart);
      const to = Math.min(e, dayEnd);
      return {
        r,
        fromHour: Math.round((from - dayStart) / 3600_000),
        toHour: Math.round((to - dayStart) / 3600_000),
        continues: e > dayEnd,
      };
    })
    .filter((x): x is Omit<Segment, "lane" | "lanes"> => x !== null)
    .sort((a, b) => a.fromHour - b.fromHour || a.toHour - b.toHour);

  // 重なりをレーンに割り当てる（横に並べる）
  const out: Segment[] = [];
  let group: (Omit<Segment, "lane" | "lanes"> & { lane: number })[] = [];
  let groupEnd = -1;

  const flush = () => {
    const lanes = group.length ? Math.max(...group.map((g) => g.lane)) + 1 : 0;
    for (const g of group) out.push({ ...g, lanes });
    group = [];
    groupEnd = -1;
  };

  for (const seg of raw) {
    if (seg.fromHour >= groupEnd && group.length) flush();
    const used = new Set(group.filter((g) => g.toHour > seg.fromHour).map((g) => g.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;
    group.push({ ...seg, lane });
    groupEnd = Math.max(groupEnd, seg.toHour);
  }
  flush();

  return out;
}

export default function CalendarView({
  view,
  anchor,
  reservations,
  visits,
  names,
  meId,
  isOwner,
}: {
  view: "week" | "month";
  anchor: string;
  reservations: Reservation[];
  /** 実際にいた記録。予約とは別物なので、別の帯として重ねる。 */
  visits: CheckIn[];
  names: Record<string, string>;
  meId: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [compact, setCompact] = useState(false); // モバイルは3日表示
  const [legend, setLegend] = useState(false);
  const [detail, setDetail] = useState<Reservation | null>(null);
  const [visit, setVisit] = useState<CheckIn | null>(null);
  const [draft, setDraft] = useState<{ date: string; start: number; end: number } | null>(null);
  const dragRef = useRef<{ date: string; from: number; to: number } | null>(null);
  const [drag, setDrag] = useState<{ date: string; from: number; to: number } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setCompact(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const today = fmtDate(nowJst());

  const days = useMemo(() => {
    const a = parseJstDate(anchor);
    if (view === "month") {
      const first = startOfWeekJst(startOfMonthJst(a));
      return Array.from({ length: 42 }, (_, i) => dayKey(addDaysJst(first, i)));
    }
    if (compact) return Array.from({ length: 3 }, (_, i) => dayKey(addDaysJst(a, i)));
    const ws = startOfWeekJst(a);
    return Array.from({ length: 7 }, (_, i) => dayKey(addDaysJst(ws, i)));
  }, [anchor, view, compact]);

  const monthLabel = useMemo(() => {
    const a = parseJstDate(view === "month" ? anchor : days[0] ?? anchor);
    return fmt(a, "yyyy年 M月");
  }, [anchor, view, days]);

  const go = (date: string, v: "week" | "month" = view) =>
    router.push(`/calendar?view=${v}&date=${date}`);

  const step = (dir: 1 | -1) => {
    const a = parseJstDate(anchor);
    if (view === "month") {
      const d = new Date(a);
      d.setUTCMonth(d.getUTCMonth() + dir);
      go(fmtDate(d));
    } else {
      go(dayKey(addDaysJst(a, dir * (compact ? 3 : 7))));
    }
  };

  /* ── ドラッグで時間帯を選ぶ ─────────────────────────────────────── */

  const beginDrag = (date: string, hour: number) => {
    dragRef.current = { date, from: hour, to: hour + 1 };
    setDrag(dragRef.current);
  };

  const extendDrag = (date: string, hour: number) => {
    const d = dragRef.current;
    if (!d || d.date !== date) return;
    dragRef.current = { ...d, to: Math.max(d.from + 1, hour + 1) };
    setDrag(dragRef.current);
  };

  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (d) setDraft({ date: d.date, start: d.from, end: Math.min(24, d.to) });
  };

  useEffect(() => {
    const up = () => {
      if (dragRef.current) endDrag();
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  return (
    <>
      <header className="cal__bar">
        <div className="cal__nav">
          <button className="btn btn-sm" onClick={() => step(-1)} aria-label="前へ">
            ←
          </button>
          <button className="btn btn-sm" onClick={() => go(today)}>
            今日
          </button>
          <button className="btn btn-sm" onClick={() => step(1)} aria-label="次へ">
            →
          </button>
        </div>

        <h1 className="cal__title mincho">{monthLabel}</h1>

        <div className="cal__views">
          <button
            className={`btn btn-sm${view === "week" ? " is-on" : ""}`}
            onClick={() => go(anchor, "week")}
          >
            週
          </button>
          <button
            className={`btn btn-sm${view === "month" ? " is-on" : ""}`}
            onClick={() => go(anchor, "month")}
          >
            月
          </button>
        </div>
      </header>

      {view === "week" ? (
        <WeekGrid
          days={days}
          today={today}
          reservations={reservations}
          visits={visits}
          onPickVisit={setVisit}
          meId={meId}
          names={names}
          drag={drag}
          onBegin={beginDrag}
          onExtend={extendDrag}
          onEnd={endDrag}
          onPick={setDetail}
        />
      ) : (
        <MonthGrid
          days={days}
          anchor={anchor}
          today={today}
          reservations={reservations}
          visits={visits}
          onPickVisit={setVisit}
          meId={meId}
          names={names}
          onPickDay={(d) => go(d, "week")}
          onPick={setDetail}
        />
      )}

      <div className="cal__legendbar">
        <button className="label cal__legendtoggle" onClick={() => setLegend((v) => !v)}>
          凡例 {legend ? "閉じる" : "開く"}
        </button>
        {legend ? (
          <div className="cal__legend">
            {["poker", "meeting", "private", "lodging", "other"].map((p) => {
              const m = purposeMeta(p as Reservation["purposes"][number]);
              return (
                <span key={p} className="cal__legenditem">
                  <span className="cal__legendswatch" style={{ background: m.color }} />
                  <span className="micro">{m.en}</span>
                  <span className="micro dim">{m.ja}</span>
                </span>
              );
            })}
            <span className="cal__legenditem">
              <span className="cal__legendswatch cal__legendswatch--outline" />
              <span className="micro">相席OK — 枠線のみ</span>
            </span>
            <span className="cal__legenditem">
              <span className="cal__legendswatch" style={{ background: "var(--claret)" }} />
              <span className="micro">貸切 — 塗りつぶし</span>
            </span>
          </div>
        ) : null}
      </div>

      {visit ? <VisitEditor visit={visit} onClose={() => setVisit(null)} /> : null}

      {detail ? (
        <Popover onClose={() => setDetail(null)}>
          <Detail
            r={detail}
            name={names[detail.created_by] ?? "メンバー"}
            editable={isOwner || detail.created_by === meId}
            names={names}
            onDone={() => setDetail(null)}
          />
        </Popover>
      ) : null}

      {draft ? (
        <Popover onClose={() => setDraft(null)}>
          <p className="label cal__drafthead">
            {fmtDateJa(parseJstDate(draft.date))} {String(draft.start).padStart(2, "0")}:00 —{" "}
            {String(draft.end).padStart(2, "0")}:00
          </p>
          <ReservationForm
            names={names}
            presetDate={draft.date}
            presetStart={draft.start}
            presetEnd={draft.end}
            onDone={() => setDraft(null)}
            onCancel={() => setDraft(null)}
          />
        </Popover>
      ) : null}
    </>
  );
}

/* ── 週表示 ─────────────────────────────────────────────────────────── */

function WeekGrid({
  days,
  today,
  reservations,
  visits,
  onPickVisit,
  meId,
  names,
  drag,
  onBegin,
  onExtend,
  onEnd,
  onPick,
}: {
  days: string[];
  today: string;
  reservations: Reservation[];
  visits: CheckIn[];
  onPickVisit: (c: CheckIn) => void;
  meId: string;
  names: Record<string, string>;
  drag: { date: string; from: number; to: number } | null;
  onBegin: (d: string, h: number) => void;
  onExtend: (d: string, h: number) => void;
  onEnd: () => void;
  onPick: (r: Reservation) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  // この施設が動くのは夜。開いた瞬間に 16:00 以降が見えている状態にする。
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 16 * ROW;
  }, []);

  return (
    <div className="cal">
      <div className="cal__head" style={{ gridTemplateColumns: `2.75rem repeat(${days.length}, 1fr)` }}>
        <span />
        {days.map((d) => (
          <div key={d} className={`cal__day${d === today ? " is-today" : ""}`}>
            <span className="micro">{fmt(parseJstDate(d), "E")}</span>
            <span className="cal__daynum num">{fmt(parseJstDate(d), "d")}</span>
          </div>
        ))}
      </div>

      <div className="cal__scroll" ref={scroller}>
      <div className="cal__body" style={{ gridTemplateColumns: `2.75rem repeat(${days.length}, 1fr)` }}>
        <div className="cal__hours">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="cal__hour" style={{ height: ROW }}>
              <span className="micro">{String(h).padStart(2, "0")}</span>
            </div>
          ))}
        </div>

        {days.map((d) => {
          const segs = segmentsForDay(reservations, d);
          return (
            <div key={d} className={`cal__col${d === today ? " is-today" : ""}`} style={{ height: ROW * 24 }}>
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  className="cal__slot"
                  style={{ height: ROW }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    onBegin(d, h);
                  }}
                  onPointerEnter={() => onExtend(d, h)}
                  onPointerUp={onEnd}
                  role="button"
                  tabIndex={-1}
                  aria-label={`${d} ${String(h).padStart(2, "0")}:00 から予約`}
                />
              ))}

              {drag && drag.date === d ? (
                <div
                  className="cal__drag"
                  style={{ top: drag.from * ROW, height: (drag.to - drag.from) * ROW }}
                />
              ) : null}

              {segs.map((s) => (
                <Block key={`${s.r.id}-${d}`} seg={s} name={names[s.r.created_by] ?? "メンバー"} onPick={onPick} />
              ))}

              {/*
                実際にいた記録。予約の帯とは別に、列の左端の細い筋として出す。
                「約束」と「実際」を同じ形で並べると、どちらを見ているか分からなくなる。
              */}
              {visitsForDay(visits, d).map((v) => (
                <button
                  key={`v-${v.c.id}-${d}`}
                  className={`cal__visit${v.c.profile_id === meId ? " is-mine" : ""}`}
                  style={{ top: v.fromHour * ROW, height: Math.max(3, (v.toHour - v.fromHour) * ROW) }}
                  title={`${names[v.c.profile_id] ?? "メンバー"} ${fmtTime(v.c.checked_in_at)}〜`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPickVisit(v.c);
                  }}
                  aria-label={`${names[v.c.profile_id] ?? "メンバー"} の滞在`}
                />
              ))}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

function Block({
  seg,
  name,
  onPick,
}: {
  seg: Segment;
  name: string;
  onPick: (r: Reservation) => void;
}) {
  const main = purposeMeta(seg.r.purposes[0]);
  const rest = seg.r.purposes.slice(1);
  const width = `calc((100% - 2px) / ${seg.lanes})`;

  return (
    <button
      className={`cal__block${seg.r.is_exclusive ? " is-exclusive" : ""}`}
      style={{
        top: seg.fromHour * ROW + 1,
        height: (seg.toHour - seg.fromHour) * ROW - 2,
        left: `calc(${seg.lane} * ${width})`,
        width,
        // 塗り = 貸切かどうか。相席OKは枠線のみで中は透過（SPEC §3-3b）
        borderColor: main.color,
        background: seg.r.is_exclusive ? main.color : "transparent",
        color: seg.r.is_exclusive ? main.onFill : "var(--paper)",
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onPick(seg.r);
      }}
    >
      <span className="cal__blockname">{name}</span>
      <span className="cal__blockpurpose">{main.en}</span>
      {rest.length > 0 ? (
        <span className="cal__stripes" aria-hidden>
          {rest.map((p) => (
            <span key={p} style={{ background: purposeMeta(p).color }} />
          ))}
        </span>
      ) : null}
    </button>
  );
}

/* ── 月表示 ─────────────────────────────────────────────────────────── */

function MonthGrid({
  days,
  anchor,
  today,
  reservations,
  visits,
  onPickVisit,
  meId,
  names,
  onPickDay,
  onPick,
}: {
  days: string[];
  anchor: string;
  today: string;
  reservations: Reservation[];
  visits: CheckIn[];
  onPickVisit: (c: CheckIn) => void;
  meId: string;
  names: Record<string, string>;
  onPickDay: (d: string) => void;
  onPick: (r: Reservation) => void;
}) {
  const anchorMonth = anchor.slice(0, 7);

  return (
    <div className="mcal">
      <div className="mcal__head">
        {["月", "火", "水", "木", "金", "土", "日"].map((w) => (
          <span key={w} className="micro">
            {w}
          </span>
        ))}
      </div>
      <div className="mcal__grid">
        {days.map((d) => {
          const segs = segmentsForDay(reservations, d);
          const outside = d.slice(0, 7) !== anchorMonth;
          return (
            <div key={d} className={`mcal__cell${outside ? " is-outside" : ""}${d === today ? " is-today" : ""}`}>
              <button className="mcal__daynum num" onClick={() => onPickDay(d)}>
                {Number(d.slice(8))}
              </button>
              <div className="mcal__bars">
                {segs.slice(0, 4).map((s) => {
                  const m = purposeMeta(s.r.purposes[0]);
                  return (
                    <button
                      key={`${s.r.id}-${d}`}
                      className={`mcal__bar${s.r.is_exclusive ? " is-exclusive" : ""}`}
                      style={{ borderColor: m.color, background: s.r.is_exclusive ? m.color : "transparent" }}
                      onClick={() => onPick(s.r)}
                      title={`${names[s.r.created_by] ?? "メンバー"} ${m.ja}`}
                    />
                  );
                })}
                {segs.length > 4 ? <span className="micro">+{segs.length - 4}</span> : null}
              </div>

              {/* 実際に人がいた日には、日付の下に小さく人数を出す。 */}
              {(() => {
                const vs = visitsForDay(visits, d);
                if (vs.length === 0) return null;
                const heads = vs.reduce((n, v) => n + (v.c.headcount || 1), 0);
                return (
                  <button
                    className="mcal__visits micro"
                    onClick={() => onPickVisit(vs[0].c)}
                    title="滞在の記録"
                  >
                    {heads}名
                  </button>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── ポップオーバー ─────────────────────────────────────────────────── */

function Popover({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="pop" role="dialog" aria-modal="true">
      <button className="pop__scrim" onClick={onClose} aria-label="閉じる" />
      <div className="pop__panel surface">{children}</div>
    </div>
  );
}

function Detail({
  r,
  name,
  editable,
  names,
  onDone,
}: {
  r: Reservation;
  name: string;
  editable: boolean;
  names: Record<string, string>;
  onDone: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) return <ReservationForm names={names} editing={r} onDone={onDone} onCancel={() => setEditing(false)} />;

  return (
    <div className="pop__detail">
      <div className="rcard__head">
        <div className="rcard__when">
          <span className="rcard__date mincho">{fmtDateJa(r.starts_at)}</span>
          <span className="rcard__time amount">
            {fmtTime(r.starts_at)}–{fmtTime(r.ends_at)}
          </span>
        </div>
        <span className={r.is_exclusive ? "badge badge-exclusive" : "badge badge-outline"}>
          {r.is_exclusive ? "貸切" : "相席OK"}
        </span>
      </div>

      <div className="rcard__purposes">
        {r.purposes.map((p) => (
          <span key={p} className="rcard__purpose" style={{ color: purposeMeta(p).text }}>
            {purposeMeta(p).en}
          </span>
        ))}
      </div>

      {r.title ? <p className="rcard__title">{r.title}</p> : null}
      <p className="micro">
        {name} · {r.headcount}名
      </p>
      {r.memo ? <p className="rcard__memo dim">{r.memo}</p> : null}
      {!r.is_exclusive ? <p className="micro">この時間は合流できます。</p> : null}

      {editable ? (
        <div className="rform__actions">
          <button className="btn" onClick={() => setEditing(true)}>
            編集
          </button>
        </div>
      ) : null}
    </div>
  );
}
