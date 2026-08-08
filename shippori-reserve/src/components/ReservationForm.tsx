"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SELECTABLE_SOURCES } from "@/lib/constants";
import { fmtDateJa, isoToMinutes, minutesToLabel } from "@/lib/time";
import type { Course, DailySummary, Reservation, SeatUnit } from "@/lib/types";
import type { ActionResult, ReservationInput } from "@/app/(app)/reservations/actions";

type Props = {
  /** 編集なら既存の予約。新規なら undefined。 */
  reservation?: Reservation;
  initialDay: DailySummary;
  courses: Course[];
  seatUnits: SeatUnit[];
  /** 新規登録時の日付。暦の＋から来た日が入る。タップすればOSのピッカーで変えられる。 */
  defaultDate: string;
  onSubmit: (input: ReservationInput) => Promise<ActionResult>;
};

const PARTY_CHIPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** ボタンで選べる受け始めは 20:30 まで（店主指定）。それ以降はプルダウンで。 */
const LAST_CHIP_MIN = 1230;

/** 席の「指定なし」。選ばれたことが分かるよう文字列で保存する。 */
const NO_SEAT = "指定なし";

/**
 * 予約登録。電話を受けながら親指だけで入力し終えることが全て。
 * 1画面に収まる密度に寄せてある（form-dense）。項目を足すときはよく考えること。
 */
export default function ReservationForm({
  reservation,
  initialDay,
  courses,
  seatUnits,
  defaultDate,
  onSubmit,
}: Props) {
  const router = useRouter();
  const editing = Boolean(reservation);

  const [bizDate, setBizDate] = useState(reservation?.biz_date ?? defaultDate);
  const [day, setDay] = useState<DailySummary>(initialDay);
  const [startMin, setStartMin] = useState<number>(
    reservation ? isoToMinutes(reservation.biz_date, reservation.starts_at) : initialDay.open_min,
  );
  const [partySize, setPartySize] = useState(reservation?.party_size ?? 2);
  const [name, setName] = useState(reservation?.customer_name ?? "");
  const [phone, setPhone] = useState(reservation?.phone ?? "");
  const [source, setSource] = useState<ReservationInput["source"]>(reservation?.source ?? "");
  const [seats, setSeats] = useState<string[]>(() => {
    const note = reservation?.seat_note;
    if (!note) return [];
    const known = new Set([NO_SEAT, ...seatUnits.map((u) => u.name)]);
    return note.split("＋").filter((s) => known.has(s));
  });
  const [courseId, setCourseId] = useState(reservation?.course_id ?? "");
  const [memo, setMemo] = useState(reservation?.memo ?? "");

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isEvent = day.mode === "event";

  /** 7名様以上はテーブルをつなげる前提なので、席を複数選べる */
  const multiAllowed = partySize >= 7;

  /*
   * 日付が変わったら、その日の営業設定を取り直す。
   * イベント営業日かどうか・何時から何時までかは、日ごとに違う。
   */
  useEffect(() => {
    if (bizDate === day.biz_date) return;
    let cancelled = false;

    fetch(`/api/days/${bizDate}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DailySummary | null) => {
        if (cancelled || !d) return;
        setDay(d);
        setStartMin((m) => (m < d.open_min || m > d.close_min - 30 ? d.open_min : m));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [bizDate, day.biz_date]);

  /** イベント営業日は席ではなく定員で見る。自分の予約ぶんは二重に数えない。 */
  const alreadyCounted = editing && reservation?.biz_date === bizDate ? reservation.party_size : 0;
  const remaining =
    isEvent && day.event_capacity !== null
      ? day.event_capacity - (day.guest_count - alreadyCounted) - partySize
      : null;

  /** ボタン：開店〜20:30 の15分刻み */
  const slots: number[] = [];
  for (let m = day.open_min; m <= Math.min(LAST_CHIP_MIN, day.close_min - 30); m += 15) {
    slots.push(m);
  }

  /** プルダウン：20:45〜閉店30分前。25:00営業の日は 24:30 まで並ぶ。 */
  const lateSlots: number[] = [];
  for (let m = LAST_CHIP_MIN + 15; m <= day.close_min - 30; m += 15) lateSlots.push(m);

  function pickSeat(seatName: string) {
    setSeats((prev) => {
      if (seatName === NO_SEAT) return prev.includes(NO_SEAT) ? [] : [NO_SEAT];
      const base = prev.filter((s) => s !== NO_SEAT);
      if (multiAllowed) {
        return base.includes(seatName) ? base.filter((s) => s !== seatName) : [...base, seatName];
      }
      return base.includes(seatName) ? [] : [seatName];
    });
  }

  function changeParty(n: number) {
    const next = Math.max(1, Math.min(100, n));
    setPartySize(next);
    // 6名以下に戻したら、つなげていた席は先頭の1つだけ残す
    if (next < 7) {
      setSeats((prev) => (prev.length > 1 && !prev.includes(NO_SEAT) ? [prev[0]] : prev));
    }
  }

  function submit() {
    setError(null);

    if (!name.trim()) {
      setError("お名前を入力してください。");
      return;
    }
    if (!isEvent && seats.length === 0) {
      setError("席を選んでください（「指定なし」も選べます）。");
      return;
    }

    const input: ReservationInput = {
      biz_date: bizDate,
      start_min: startMin,
      party_size: partySize,
      customer_name: name,
      phone,
      source,
      seat_note: isEvent ? "" : seats.join("＋"),
      course_id: courseId,
      memo,
    };

    startTransition(async () => {
      const res = await onSubmit(input);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(editing ? `/reservations/${res.id}` : `/day/${bizDate}`);
      router.refresh();
    });
  }

  return (
    <form
      className="stack form-dense"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {/* 1. お名前 */}
      <div>
        <label className="field-label" htmlFor="customer_name">
          お名前<span className="req">必須</span>
        </label>
        <div className="row" style={{ gap: "0.5rem" }}>
          <input
            id="customer_name"
            className="field"
            style={{ flex: 1 }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <span style={{ whiteSpace: "nowrap" }}>様</span>
        </div>
      </div>

      {/* 2. 日付 ─ タップするとOSのピッカー（スクロール式）で変えられる */}
      <div>
        <label className="field-label" htmlFor="biz_date">
          日付
        </label>
        <input
          id="biz_date"
          type="date"
          className="field datefield"
          value={bizDate}
          onChange={(e) => e.target.value && setBizDate(e.target.value)}
        />
        <p className="micro" style={{ marginTop: "0.25rem" }}>
          {fmtDateJa(bizDate)}・{isEvent ? "イベント営業" : "通常営業"}
          {day.is_busy ? "・繁忙日" : ""}
          {day.is_closed ? "・休業日の設定です" : ""}
        </p>
      </div>

      {/* 3. 時刻 ─ 15分刻みで20:30まで。それ以降はプルダウンで。 */}
      <div>
        <label className="field-label">
          時刻<span className="req">必須</span>
        </label>
        <div className="chips">
          {slots.map((m) => (
            <button
              key={m}
              type="button"
              className="chip chip--num"
              aria-pressed={startMin === m}
              onClick={() => setStartMin(m)}
            >
              {minutesToLabel(m)}
            </button>
          ))}
          {lateSlots.length > 0 ? (
            <select
              className="field"
              style={{ width: "auto", minHeight: "2.15rem" }}
              value={lateSlots.includes(startMin) ? startMin : ""}
              onChange={(e) => e.target.value && setStartMin(Number(e.target.value))}
              aria-label="20:30より後の時刻"
            >
              <option value="">20:30より後 ▾</option>
              {lateSlots.map((m) => (
                <option key={m} value={m}>
                  {minutesToLabel(m)}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      {/* 4. 人数 ─ チップ＋ステッパー。数字を打たせない。 */}
      <div>
        <label className="field-label">
          人数<span className="req">必須</span>
        </label>
        <div className="chips">
          {PARTY_CHIPS.map((n) => (
            <button
              key={n}
              type="button"
              className="chip chip--num"
              aria-pressed={partySize === n}
              onClick={() => changeParty(n)}
            >
              {n}
            </button>
          ))}
          <span className="stepper">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => changeParty(partySize - 1)}
              aria-label="1名減らす"
            >
              −
            </button>
            <span className="stepper__num">{partySize}名</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => changeParty(partySize + 1)}
              aria-label="1名増やす"
            >
              ＋
            </button>
          </span>
        </div>

        {remaining !== null ? (
          <p className={remaining < 0 ? "err" : "micro"} style={{ marginTop: "0.35rem" }}>
            {remaining < 0
              ? `定員を ${-remaining} 名超えています（定員 ${day.event_capacity} 名）`
              : `この予約を入れると 残り ${remaining} 名（定員 ${day.event_capacity} 名）`}
          </p>
        ) : null}
      </div>

      {/* 5. 電話番号 */}
      <div>
        <label className="field-label" htmlFor="phone">
          電話番号
        </label>
        <input
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          className="field"
          value={phone ?? ""}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>

      {/* 6. 流入元 ─ 既定値を置かない。選ばないと保存できない。 */}
      <div>
        <label className="field-label">
          どこから来た予約か<span className="req">必須</span>
        </label>
        <div className="chips">
          {SELECTABLE_SOURCES.map((s) => (
            <button
              key={s.value}
              type="button"
              className="chip"
              aria-pressed={source === s.value}
              onClick={() => setSource(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* 7. 席 ─ 必須。「指定なし」も選択のうち。7名様以上は複数選べる。 */}
      {!isEvent ? (
        <div>
          <label className="field-label">
            席<span className="req">必須</span>
            {multiAllowed ? (
              <span className="micro" style={{ marginLeft: "0.5rem" }}>
                7名様以上はつなげて複数選べます
              </span>
            ) : null}
          </label>
          <div className="chips">
            {seatUnits.map((u) => (
              <button
                key={u.id}
                type="button"
                className="chip"
                aria-pressed={seats.includes(u.name)}
                onClick={() => pickSeat(u.name)}
              >
                {u.name}
                <span className="micro" style={{ marginLeft: "0.3rem" }}>
                  {u.capacity}
                </span>
              </button>
            ))}
            <button
              type="button"
              className="chip"
              aria-pressed={seats.includes(NO_SEAT)}
              onClick={() => pickSeat(NO_SEAT)}
            >
              {NO_SEAT}
            </button>
          </div>
        </div>
      ) : null}

      {/* 8. コース（飲み放題の有無はコース側に含まれている） */}
      <div>
        <label className="field-label" htmlFor="course">
          コース（任意）
        </label>
        <select
          id="course"
          className="field"
          value={courseId ?? ""}
          onChange={(e) => setCourseId(e.target.value)}
        >
          <option value="">指定なし</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.price_yen ? `（${c.price_yen.toLocaleString()}円）` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* 9. メモ（アレルギー・お祝いなどもここへ） */}
      <div>
        <label className="field-label" htmlFor="memo">
          メモ（任意）
        </label>
        <textarea
          id="memo"
          className="field"
          placeholder="アレルギー・お祝い・領収書の宛名 など"
          value={memo ?? ""}
          onChange={(e) => setMemo(e.target.value)}
        />
      </div>

      {error ? <p className="err">{error}</p> : null}

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? "保存中" : editing ? "変更を保存" : "この内容で登録"}
      </button>
    </form>
  );
}
