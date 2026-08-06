"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import ReservationForm from "@/components/ReservationForm";
import { yen } from "@/lib/money";
import { OPEN_TABLE_HOURS, pairTables, rakeStartedOn, tableSpan } from "@/lib/tables";
import { DAY_START_HOUR, addDaysJst, clockLabel, dayWindow, fmt, fmtDate, fmtDateJa, fmtTime, nowJst, startOfMonthJst, startOfWeekJst } from "@/lib/time";
import VisitEditor from "@/components/VisitEditor";
import { purposeMeta, type CheckIn, type Reservation, type Session } from "@/lib/types";

/*
 * 1時間ぶんの高さは割合で持つ。
 *
 * 固定pxだと 24時間 × 34px = 816px になり、スマホの画面には収まらないので
 * 必ず縦スクロールが要る。列の高さを画面に合わせて、そのなかを24等分する。
 */
const pct = (hours: number) => `${(hours / 24) * 100}%`;

/**
 * 時間の格子に置くもの。
 *
 * 予約（これからの約束）と卓（実際に開催された記録）は別の物だが、
 * どちらも「その時間、部屋が使われている」ことを表す。同じ形の枠で出さないと、
 * 予約を出していない夜だけ細い線になって、開催が無かったように見える。
 * 重なりを横に並べる計算も共通なので、ひとつの型にまとめる。
 */
type Piece =
  | { kind: "reservation"; r: Reservation }
  | { kind: "table"; s: Session };

/** 日内に切り出したところまで。まだ横の位置は決まっていない。 */
type Placed = Piece & {
  fromHour: number; // 0..23
  toHour: number; // 1..24
  continues: boolean; // 翌日に続く
  head: boolean; // この日に始まった（前日から続いている側は false）
};

/** 重なりを横に並べたあと。 */
type Segment = Placed & { lane: number; lanes: number };

const segKey = (seg: Segment) => (seg.kind === "reservation" ? seg.r.id : seg.s.id);

/**
 * 枠の中に出す呼び名。名（ファーストネーム）だけにする。
 *
 * 表示名は姓名をつなげた1語（YuyaNishibara）。列は7日ぶんに割ると50px前後
 * しかないので、そのままだと「Yuya…」と切れて誰か分からない。
 * 名だけなら6人ともそのまま入る（いちばん長いのは Hiroaki）。
 * 切り出せない形の名前は、そのまま出す。
 */
function givenName(full: string): string {
  const m = /^[A-Z][a-z]+/.exec(full);
  return m ? m[0] : full;
}

/** 滞在の1本。予約と同じ時間軸に、細い帯として並べる。 */
type VisitSeg = { c: CheckIn; fromHour: number; toHour: number };

/**
 * 実際に立った卓の1本。
 *
 * head は「この日に始まった卓」。深夜2時までの卓は翌日にも掛かるが、
 * レーキはその夜1回ぶんしかない。金額を出すのは head の側だけにする。
 */
type TableSeg = { s: Session; fromHour: number; toHour: number; open: boolean; head: boolean };

/**
 * その日にかかった卓を切り出す。
 *
 * 終了時刻は任意入力なので空のことが多い。空なら開始から1時間ぶんの
 * 印として出す。長さを勝手に伸ばすと、入っていない情報を書いたことになる。
 */
function tablesForDay(sessions: Session[], date: string): TableSeg[] {
  const [dayStart, dayEnd] = dayWindow(date);

  return sessions
    .map((s) => {
      const [st, en] = tableSpan(s);
      if (en <= dayStart || st >= dayEnd) return null;
      return {
        s,
        fromHour: Math.max(0, (Math.max(st, dayStart) - dayStart) / 3600_000),
        toHour: Math.min(24, (Math.min(en, dayEnd) - dayStart) / 3600_000),
        open: !s.ended_at,
        head: st >= dayStart,
      };
    })
    .filter((x): x is TableSeg => x !== null)
    .sort((a, b) => a.fromHour - b.fromHour);
}

/**
 * その日にかかる滞在を切り出す。
 *
 * 予約は「これから使う約束」、滞在は「実際にいた記録」。別の物なので、
 * レーンを共有せず、列の左端の細い帯にまとめて出す。
 */
function visitsForDay(visits: CheckIn[], date: string): VisitSeg[] {
  const [dayStart, dayEnd] = dayWindow(date);
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

/** その日に始まった卓のレーキ合計。 */
function rakeOnDay(list: Session[] | undefined, date: string): number {
  return rakeStartedOn(list, ...dayWindow(date));
}

const dayKey = (d: Date) => fmtDate(d);
const parseJstDate = (s: string) => new Date(`${s}T00:00:00+09:00`);

/**
 * その日に重なる予約と卓を、日内のセグメントに切り出す。
 *
 * 卓は終了時刻が入っているものだけ。終了が空だと長さが分からないので、
 * 枠にはせず別に小さな印として出す（勝手な長さを描かないため）。
 */
function segmentsForDay(
  reservations: Reservation[],
  tables: Session[],
  date: string,
): Segment[] {
  const [dayStart, dayEnd] = dayWindow(date);

  const pieces: { piece: Piece; s: number; e: number }[] = [
    ...reservations.map((r) => ({
      piece: { kind: "reservation" as const, r },
      s: new Date(r.starts_at).getTime(),
      e: new Date(r.ends_at).getTime(),
    })),
    ...tables
      .filter((t) => t.ended_at)
      .map((t) => ({
        piece: { kind: "table" as const, s: t },
        s: new Date(t.started_at).getTime(),
        e: new Date(t.ended_at as string).getTime(),
      })),
  ];

  const raw = pieces
    .map(({ piece, s, e }) => {
      if (e <= dayStart || s >= dayEnd) return null;
      const from = Math.max(s, dayStart);
      const to = Math.min(e, dayEnd);
      return {
        ...piece,
        fromHour: Math.round((from - dayStart) / 3600_000),
        toHour: Math.round((to - dayStart) / 3600_000),
        continues: e > dayEnd,
        head: s >= dayStart,
      };
    })
    .filter((x): x is Placed => x !== null)
    .sort((a, b) => a.fromHour - b.fromHour || a.toHour - b.toHour);

  // 重なりをレーンに割り当てる（横に並べる）
  const out: Segment[] = [];
  let group: (Placed & { lane: number })[] = [];
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
  sessions,
  names,
  meId,
  isOwner,
}: {
  view: "week" | "month";
  anchor: string;
  reservations: Reservation[];
  /** 実際にいた記録。予約とは別物なので、別の帯として重ねる。 */
  visits: CheckIn[];
  /** 実際に立った卓。記録タブでレーキを入れると、そのままここに出る。 */
  sessions: Session[];
  names: Record<string, string>;
  meId: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [legend, setLegend] = useState(false);
  const [detail, setDetail] = useState<Reservation | null>(null);
  const [visit, setVisit] = useState<CheckIn | null>(null);
  const [table, setTable] = useState<Session | null>(null);
  const [draft, setDraft] = useState<{ date: string; start: number; end: number } | null>(null);
  const dragRef = useRef<{ date: string; from: number; to: number } | null>(null);
  const [drag, setDrag] = useState<{ date: string; from: number; to: number } | null>(null);

  const today = fmtDate(nowJst());

  // 予約と卓の対応づけ。週・月・詳細で同じ束ね方を使う。
  const { byReservation, loose } = useMemo(
    () => pairTables(reservations, sessions),
    [reservations, sessions],
  );

  const days = useMemo(() => {
    const a = parseJstDate(anchor);
    if (view === "month") {
      const first = startOfWeekJst(startOfMonthJst(a));
      return Array.from({ length: 42 }, (_, i) => dayKey(addDaysJst(first, i)));
    }
    const ws = startOfWeekJst(a);
    return Array.from({ length: 7 }, (_, i) => dayKey(addDaysJst(ws, i)));
  }, [anchor, view]);

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
      go(dayKey(addDaysJst(a, dir * 7)));
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

  /*
   * 掴んだのは「4時始まりの格子の何行目か」。予約そのものは普通の日付と時刻で
   * 持っているので、ここで直す。24時を越えた行は、翌日の 0〜3時として渡す。
   */
  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    const from = d.from + DAY_START_HOUR;
    const to = d.to + DAY_START_HOUR;
    const shift = from >= 24 ? 24 : 0;
    setDraft({
      date: shift ? dayKey(addDaysJst(parseJstDate(d.date), 1)) : d.date,
      start: from - shift,
      end: to - shift,
    });
  };

  /** 何も作らずに畳む。指がグリッドの外で離れたときと、スクロールに化けたとき。 */
  const cancelDrag = () => {
    dragRef.current = null;
    setDrag(null);
  };

  /*
   * 掴んだ指がどこで離れても必ず終わらせる。確定するかどうかの判断はここ1か所だけ。
   *
   * もとは pointerup をマス目にしか付けていなかった。マス目の外（月/週のボタンの上など）で
   * 指を離すと掴んだ状態が残り、次にどこかを押した拍子にそれが確定して、覚えのない
   * 予約の下書きが開いていた。
   *
   * マス目側にも pointerup を残すと「先に走ったほうが勝つ」競争になり、
   * 外で離したのに下書きができることがある。だからマス目からは外し、
   * 指が離れた場所をここで見て決める。
   *
   * スクロールに化けた場合はブラウザが pointercancel を投げてくるので、それも拾う。
   */
  useEffect(() => {
    if (!drag) return;
    const up = (e: PointerEvent) => {
      const inside = (e.target as HTMLElement | null)?.closest?.(".cal__col");
      if (inside) endDrag();
      else cancelDrag();
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancelDrag);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancelDrag);
    };
  }, [drag]);

  // 表示を切り替えたら掴みかけは捨てる
  useEffect(() => {
    cancelDrag();
  }, [view, anchor]);

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
          byReservation={byReservation}
          loose={loose}
          onPickVisit={setVisit}
          onPickTable={setTable}
          meId={meId}
          names={names}
          drag={drag}
          onBegin={beginDrag}
          onExtend={extendDrag}
          onPick={setDetail}
        />
      ) : (
        <MonthGrid
          days={days}
          anchor={anchor}
          today={today}
          reservations={reservations}
          visits={visits}
          sessions={sessions}
          loose={loose}
          meId={meId}
          names={names}
          onPickDay={(d) => go(d, "week")}
          onPick={setDetail}
          onPickTable={setTable}
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
            <span className="cal__legenditem">
              <span className="cal__legendswatch cal__legendswatch--outline" />
              <span className="micro">卓 — 枠の中に金額</span>
            </span>
            <span className="cal__legenditem">
              <span className="cal__legendswatch cal__legendswatch--table" />
              <span className="micro">終了未入力の卓 — 金額だけ</span>
            </span>
            <span className="cal__legenditem">
              <span className="cal__legendswatch cal__legendswatch--visit" />
              <span className="micro">滞在 — 左端の筋</span>
            </span>
          </div>
        ) : null}
      </div>

      {visit ? <VisitEditor visit={visit} onClose={() => setVisit(null)} /> : null}

      {table ? (
        <Popover onClose={() => setTable(null)}>
          <TableDetail
            s={table}
            name={table.created_by ? (names[table.created_by] ?? "メンバー") : "—"}
          />
        </Popover>
      ) : null}

      {detail ? (
        <Popover onClose={() => setDetail(null)}>
          <Detail
            r={detail}
            name={names[detail.created_by] ?? "メンバー"}
            tables={byReservation.get(detail.id) ?? []}
            editable={isOwner || detail.created_by === meId}
            names={names}
            onDone={() => setDetail(null)}
          />
        </Popover>
      ) : null}

      {draft ? (
        <Popover onClose={() => setDraft(null)}>
          <p className="label cal__drafthead">
            {fmtDateJa(parseJstDate(draft.date))} {clockLabel(draft.start)} —{" "}
            {clockLabel(draft.end)}
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
  byReservation,
  loose,
  onPickVisit,
  onPickTable,
  meId,
  names,
  drag,
  onBegin,
  onExtend,
  onPick,
}: {
  days: string[];
  today: string;
  reservations: Reservation[];
  visits: CheckIn[];
  /** 予約ID → その夜の卓。予約の帯の中に金額として出す。 */
  byReservation: Map<string, Session[]>;
  /** 予約の無い卓。単独の印として出す。 */
  loose: Session[];
  onPickVisit: (c: CheckIn) => void;
  onPickTable: (s: Session) => void;
  meId: string;
  names: Record<string, string>;
  drag: { date: string; from: number; to: number } | null;
  onBegin: (d: string, h: number) => void;
  onExtend: (d: string, h: number) => void;
  onPick: (r: Reservation) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  /*
   * ふつうは24時間ぶんが1画面に収まるので、何もしない。
   * 画面の縦がよほど短くて収まらないときだけ、夜（この施設が動く時間）へ寄せる。
   */
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const over = el.scrollHeight - el.clientHeight;
    if (over > 0) el.scrollTop = Math.min(over, (el.scrollHeight * 16) / 24);
  }, []);

  return (
    <div className="cal">
      <div className="cal__head" style={{ gridTemplateColumns: `var(--cal-gutter) repeat(${days.length}, 1fr)` }}>
        <span />
        {days.map((d) => (
          <div key={d} className={`cal__day${d === today ? " is-today" : ""}`}>
            <span className="micro">{fmt(parseJstDate(d), "E")}</span>
            <span className="cal__daynum num">{fmt(parseJstDate(d), "d")}</span>
          </div>
        ))}
      </div>

      <div className="cal__scroll" ref={scroller}>
      <div className="cal__body" style={{ gridTemplateColumns: `var(--cal-gutter) repeat(${days.length}, 1fr)` }}>
        <div className="cal__hours">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="cal__hour">
              <span className="micro">{String(h + DAY_START_HOUR).padStart(2, "0")}</span>
            </div>
          ))}
        </div>

        {days.map((d) => {
          const segs = segmentsForDay(reservations, loose, d);
          return (
            <div key={d} className={`cal__col${d === today ? " is-today" : ""}`}>
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  className="cal__slot"
                  onPointerDown={() => {
                    // preventDefault は入れない。入れるとブラウザが縦スクロールを
                    // 引き受けられなくなり、スクロールのつもりの指が掴みになる。
                    onBegin(d, h);
                  }}
                  onPointerEnter={() => onExtend(d, h)}
                  role="button"
                  tabIndex={-1}
                  aria-label={`${d} ${clockLabel(h + DAY_START_HOUR)} から予約`}
                />
              ))}

              {drag && drag.date === d ? (
                <div
                  className="cal__drag"
                  style={{ top: pct(drag.from), height: pct(drag.to - drag.from) }}
                />
              ) : null}

              {segs.map((seg) => (
                <Block
                  key={`${segKey(seg)}-${d}`}
                  seg={seg}
                  names={names}
                  rake={
                    seg.kind === "reservation"
                      ? rakeOnDay(byReservation.get(seg.r.id), d)
                      : seg.s.rake_yen
                  }
                  onPick={onPick}
                  onPickTable={onPickTable}
                />
              ))}

              {/*
                実際にいた記録。予約の帯とは別に、列の左端の細い筋として出す。
                「約束」と「実際」を同じ形で並べると、どちらを見ているか分からなくなる。
              */}
              {visitsForDay(visits, d).map((v) => (
                <button
                  key={`v-${v.c.id}-${d}`}
                  className={`cal__visit${v.c.profile_id === meId ? " is-mine" : ""}`}
                  style={{ top: pct(v.fromHour), height: pct(v.toHour - v.fromHour) }}
                  title={`${names[v.c.profile_id] ?? "メンバー"} ${fmtTime(v.c.checked_in_at)}〜`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPickVisit(v.c);
                  }}
                  aria-label={`${names[v.c.profile_id] ?? "メンバー"} の滞在`}
                />
              ))}

              {/*
                終了時刻が入っていない卓。長さが分からないので枠にできない。
                始まった時刻に金額だけを置く。
                終了が入っている卓は上の枠として出しているので、ここには来ない。
              */}
              {tablesForDay(loose.filter((x) => !x.ended_at), d).map((t) => (
                <button
                  key={`t-${t.s.id}-${d}`}
                  className={`cal__table${t.open ? " is-open" : ""}${t.head ? "" : " is-tail"}`}
                  style={{
                    top: pct(t.fromHour),
                    /*
                     * 終了時刻が入っていない卓は、長さを描かない。
                     * 仮の長さで枠を出すと「20:00から21:00まで」と読めてしまい、
                     * 入っていない情報を画面が言い切ることになる。
                     * 始まった時刻に金額だけを置く。
                     */
                    ...(t.open
                      ? {}
                      : { height: pct(t.toHour - t.fromHour) }),
                  }}
                  title={
                    t.s.ended_at
                      ? `卓 ${fmtTime(t.s.started_at)}–${fmtTime(t.s.ended_at)} ${yen(t.s.rake_yen)}`
                      : `卓 ${fmtTime(t.s.started_at)}〜 ${yen(t.s.rake_yen)}（終了時刻は未入力）`
                  }
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPickTable(t.s);
                  }}
                >
                  {/* 日をまたいだ後ろ半分には金額を出さない。同じ卓が2回入ったように見えるため。 */}
                  {t.head ? <span className="cal__tableamt amount">{yen(t.s.rake_yen)}</span> : null}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

/**
 * 時間の格子に置く1枚。
 *
 * 予約でも卓でも同じ形で出す。卓を細い線にしていたら、予約を出していない夜の
 * 開催だけ線になって「反映されていない」ように見えた。
 * 卓はポーカーの色（真鍮）で、塗りはしない — 塗りは貸切のしるしなので。
 */
function Block({
  seg,
  names,
  rake,
  onPick,
  onPickTable,
}: {
  seg: Segment;
  names: Record<string, string>;
  /** 予約ならその夜の卓のレーキ（0 なら記録がまだ無い）、卓ならその卓のレーキ。 */
  rake: number;
  onPick: (r: Reservation) => void;
  onPickTable: (s: Session) => void;
}) {
  const isRes = seg.kind === "reservation";
  const main = isRes ? purposeMeta(seg.r.purposes[0]) : purposeMeta("poker");
  const rest = isRes ? seg.r.purposes.slice(1) : [];
  const filled = isRes && seg.r.is_exclusive;
  const by = isRes ? seg.r.created_by : seg.s.created_by;
  const name = (by && names[by]) || "メンバー";
  const width = `calc((100% - 2px) / ${seg.lanes})`;

  return (
    <button
      className={`cal__block${filled ? " is-exclusive" : ""}${seg.head ? "" : " is-tail"}`}
      style={{
        top: pct(seg.fromHour),
        height: pct(seg.toHour - seg.fromHour),
        left: `calc(${seg.lane} * ${width})`,
        width,
        // 塗り = 貸切かどうか。相席OKは枠線のみで中は透過（SPEC §3-3b）
        borderColor: main.color,
        background: filled ? main.color : "transparent",
        color: filled ? main.onFill : "var(--paper)",
      }}
      title={
        isRes
          ? `${name} ${fmtTime(seg.r.starts_at)}–${fmtTime(seg.r.ends_at)}`
          : `卓 ${name} ${fmtTime(seg.s.started_at)}–${fmtTime(seg.s.ended_at as string)} ${yen(seg.s.rake_yen)}`
      }
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (seg.kind === "reservation") onPick(seg.r);
        else onPickTable(seg.s);
      }}
    >
      {/*
        名前・用途・金額は始まった側にだけ。前日から続いている側にも書くと、
        同じ開催が2件あるように見える。時間軸の上なので枠だけは残す
        — 消すと、深夜まで続いた卓が24時で終わったことになってしまう。
      */}
      {seg.head ? (
        <>
          <span className="cal__blockname">{givenName(name)}</span>
          <span className="cal__blockpurpose">{main.en}</span>
          {/* この夜のレーキ。予約と卓は同じ開催なので、帯を分けずにここへ入れる。 */}
          {rake > 0 ? <span className="cal__blockrake amount">{yen(rake)}</span> : null}
        </>
      ) : null}
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
  sessions,
  loose,
  meId,
  names,
  onPickDay,
  onPick,
  onPickTable,
}: {
  days: string[];
  anchor: string;
  today: string;
  reservations: Reservation[];
  visits: CheckIn[];
  sessions: Session[];
  /** 予約に紐づかない卓。予約と同じくバーとして出す。 */
  loose: Session[];
  meId: string;
  names: Record<string, string>;
  onPickDay: (d: string) => void;
  onPick: (r: Reservation) => void;
  onPickTable: (s: Session) => void;
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
          // 1回の開催は1本だけ。深夜まで続いた予約を翌日にも出すと、2件あったように見える。
          const bars = [
            ...segmentsForDay(reservations, [], d)
              .filter(
                (x): x is Segment & { kind: "reservation"; r: Reservation } =>
                  x.head && x.kind === "reservation",
              )
              .map((x) => {
                const m = purposeMeta(x.r.purposes[0]);
                return {
                  key: `r-${x.r.id}`,
                  color: m.color,
                  filled: x.r.is_exclusive,
                  title: `${names[x.r.created_by] ?? "メンバー"} ${m.ja}`,
                  onClick: () => onPick(x.r),
                };
              }),
            // 予約せずに立った卓。ポーカーの色で、塗りはしない（塗りは貸切のしるし）。
            ...tablesForDay(loose, d)
              .filter((t) => t.head)
              .map((t) => ({
                key: `t-${t.s.id}`,
                color: purposeMeta("poker").color,
                filled: false,
                title: `卓 ${t.s.created_by ? (names[t.s.created_by] ?? "メンバー") : "メンバー"} ${yen(t.s.rake_yen)}`,
                onClick: () => onPickTable(t.s),
              })),
          ];
          const outside = d.slice(0, 7) !== anchorMonth;
          return (
            <div key={d} className={`mcal__cell${outside ? " is-outside" : ""}${d === today ? " is-today" : ""}`}>
              <button className="mcal__daynum num" onClick={() => onPickDay(d)}>
                {Number(d.slice(8))}
              </button>
              {/*
                その日にあったこと。予約も卓も同じバーで出す。
                予約のある日だけバーが付いていると、記録しかない日が
                「何も無かった日」に見える。
                予約と同じ夜の卓は予約のバーに含まれているので、ここには出さない。
              */}
              <div className="mcal__bars">
                {bars.slice(0, 4).map((bar) => (
                  <button
                    key={bar.key}
                    className={`mcal__bar${bar.filled ? " is-exclusive" : ""}`}
                    style={{ borderColor: bar.color, background: bar.filled ? bar.color : "transparent" }}
                    onClick={bar.onClick}
                    title={bar.title}
                  />
                ))}
                {bars.length > 4 ? <span className="micro">+{bars.length - 4}</span> : null}
              </div>

              {/*
                その日に立った卓のレーキ合計。月表示で真っ先に知りたいのはこれ。
                何卓立ったかは金額の横に小さく添える（1卓なら出さない）。
              */}
              {(() => {
                // 深夜に日をまたいだ卓は始まった日にだけ数える。両日に出すと合計が倍になる。
                const ts = tablesForDay(sessions, d).filter((t) => t.head);
                if (ts.length === 0) return null;
                const total = ts.reduce((n, t) => n + t.s.rake_yen, 0);
                return (
                  <button className="mcal__rake amount" onClick={() => onPickDay(d)}>
                    {yen(total)}
                    {ts.length > 1 ? <span className="micro"> {ts.length}卓</span> : null}
                  </button>
                );
              })()}

              {/*
                実際に人がいた日の印。
                数えるのは「その日いた人の数」— 同じ人が出入りを繰り返しても1人。
                滞在の本数を足すと、休憩で出入りしただけの日が大人数の日に見える。
                連れがいた場合は最も多かったときの人数を足す。
                押すとその日の週表示へ移る（日付の数字と同じふるまい）。
              */}
              {(() => {
                const vs = visitsForDay(visits, d);
                if (vs.length === 0) return null;
                const members = new Set(vs.map((v) => v.c.profile_id)).size;
                const guests = Math.max(0, ...vs.map((v) => (v.c.headcount || 1) - 1));
                return (
                  <button className="mcal__visits micro" onClick={() => onPickDay(d)}>
                    滞在 {members + guests}人
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

/**
 * 卓の中身。
 *
 * 直しは記録タブに任せる。同じものを直せる場所を2つ作ると、
 * どちらが本物か分からなくなるため、ここは読むだけにする。
 */
function TableDetail({ s, name }: { s: Session; name: string }) {
  return (
    <div className="pop__detail">
      <div className="rcard__head">
        <div className="rcard__when">
          <span className="rcard__date mincho">{fmtDateJa(s.started_at)}</span>
          <span className="rcard__time amount">
            {fmtTime(s.started_at)}
            {s.ended_at ? `–${fmtTime(s.ended_at)}` : "〜"}
          </span>
        </div>
        <span className="badge badge-outline">卓</span>
      </div>

      <p className="tdetail__rake amount">{yen(s.rake_yen)}</p>
      <p className="micro">
        {name} · {s.headcount}名
      </p>
      {s.note ? <p className="rcard__memo dim">{s.note}</p> : null}

      {/* 枠が短く見える理由をここで言う。画面が黙って仮の長さを描かないため。 */}
      {!s.ended_at ? (
        <p className="micro dim">
          終了時刻が入っていないので、カレンダーには開始時刻だけを置いています。
          記録で終了を入れると、開催時間が枠として出ます。
        </p>
      ) : null}

      <div className="rform__actions">
        <Link href="/sessions" className="btn">
          記録で直す
        </Link>
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
  tables,
  editable,
  names,
  onDone,
}: {
  r: Reservation;
  name: string;
  /** この予約と同じ夜に立った卓。予約とは別の記録なので、金額だけ添える。 */
  tables: Session[];
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

      {tables.length > 0 ? (
        <p className="rcard__rake">
          <span className="label">この夜のレーキ</span>
          <span className="amount">{yen(tables.reduce((n, t) => n + t.rake_yen, 0))}</span>
        </p>
      ) : null}

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
