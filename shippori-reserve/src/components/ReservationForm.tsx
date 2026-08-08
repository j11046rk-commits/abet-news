"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SELECTABLE_SOURCES } from "@/lib/constants";
import { fmtDateJa, isoToMinutes, labelToMinutes, minutesToLabel } from "@/lib/time";
import type { Course, DailySummary, Reservation, SeatUnit } from "@/lib/types";
import type { ActionResult, ReservationInput } from "@/app/(app)/reservations/actions";

type Props = {
  /** 編集なら既存の予約。新規なら undefined。 */
  reservation?: Reservation;
  initialDay: DailySummary;
  courses: Course[];
  seatUnits: SeatUnit[];
  /** 新規登録時の日付。暦の＋から来た日がそのまま入る（この画面では変えられない）。 */
  defaultDate: string;
  onSubmit: (input: ReservationInput) => Promise<ActionResult>;
};

const PARTY_CHIPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** 予約の受け始めは 20:30 まで（店主指定）。それ以降は任意入力で。 */
const LAST_START_MIN = 1230;

/** 席の選択肢としての「指定なし」。選ばれたことが分かるよう文字列で保存する。 */
const NO_SEAT = "指定なし";

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
  const [customTime, setCustomTime] = useState("");
  const [partySize, setPartySize] = useState(reservation?.party_size ?? 2);
  const [name, setName] = useState(reservation?.customer_name ?? "");
  const [kana, setKana] = useState(reservation?.customer_kana ?? "");
  const [phone, setPhone] = useState(reservation?.phone ?? "");
  const [source, setSource] = useState<ReservationInput["source"]>(reservation?.source ?? "");
  const [seats, setSeats] = useState<string[]>(() => {
    const note = reservation?.seat_note;
    if (!note) return [];
    const known = new Set([NO_SEAT, ...seatUnits.map((u) => u.name)]);
    return note.split("＋").filter((s) => known.has(s));
  });
  const [courseId, setCourseId] = useState(reservation?.course_id ?? "");
  const [drinkPlan, setDrinkPlan] = useState(reservation?.drink_plan ?? false);
  const [allergy, setAllergy] = useState(reservation?.allergy ?? "");
  const [memo, setMemo] = useState(reservation?.memo ?? "");
  const [again, setAgain] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isEvent = day.mode === "event";

  /** 7名様以上はテーブルをつなげる前提なので、席を複数選べる */
  const multiAllowed = partySize >= 7;

  /*
   * 日付が変わったら（編集で変えたときだけ）、その日の営業設定を取り直す。
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

  const slots: number[] = [];
  for (let m = day.open_min; m <= Math.min(LAST_START_MIN, day.close_min - 30); m += 15) {
    slots.push(m);
  }

  function pickTime(m: number) {
    setStartMin(m);
    setCustomTime("");
  }

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
    setPartySize(n);
    // 6名以下に戻したら、つなげていた席は先頭の1つだけ残す
    if (n < 7) {
      setSeats((prev) => (prev.length > 1 && !prev.includes(NO_SEAT) ? [prev[0]] : prev));
    }
  }

  function submit() {
    setError(null);

    if (!isEvent && seats.length === 0) {
      setError("席を選んでください（「指定なし」も選べます）。");
      return;
    }

    const input: ReservationInput = {
      biz_date: bizDate,
      start_min: startMin,
      party_size: partySize,
      customer_name: name,
      customer_kana: kana,
      phone,
      source,
      seat_note: isEvent ? "" : seats.join("＋"),
      course_id: courseId,
      drink_plan: drinkPlan,
      allergy,
      memo,
    };

    startTransition(async () => {
      const res = await onSubmit(input);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (editing) {
        router.push(`/reservations/${res.id}`);
      } else if (again) {
        // 続けて登録。日付と時刻は残し、お客様の情報だけ空にする。
        setName("");
        setKana("");
        setPhone("");
        setSeats([]);
        setMemo("");
        setAllergy("");
        setPartySize(2);
        router.refresh();
      } else {
        router.push(`/day/${bizDate}`);
      }
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
      {day.is_closed ? (
        <p className="notice notice-strong">
          {fmtDateJa(bizDate)} は休業日として設定されています。予約を入れる場合はご確認ください。
        </p>
      ) : null}

      {/* 日付。暦でタップした日がそのまま入るので、ここでは選ばせない。 */}
      {editing ? (
        <div>
          <label className="field-label" htmlFor="biz_date">
            日付
          </label>
          <input
            id="biz_date"
            type="date"
            className="field"
            value={bizDate}
            onChange={(e) => e.target.value && setBizDate(e.target.value)}
          />
          <p className="micro" style={{ marginTop: "0.35rem" }}>
            {fmtDateJa(bizDate)}・{isEvent ? "イベント営業" : "通常営業"}
            {day.is_busy ? "・繁忙日" : ""}
          </p>
        </div>
      ) : (
        <p
          className="notice"
          style={{ fontFamily: "var(--font-serif)", fontSize: "1.05rem", color: "var(--gold-soft)" }}
        >
          {fmtDateJa(bizDate)}
          <span className="micro" style={{ marginLeft: "0.6rem" }}>
            {isEvent ? "イベント営業" : "通常営業"}
            {day.is_busy ? "・繁忙日" : ""}
          </span>
        </p>
      )}

      {/* 時刻 ─ 15分刻みで20:30まで。それ以降（二次会など）は任意入力で。 */}
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
              aria-pressed={startMin === m && !customTime}
              onClick={() => pickTime(m)}
            >
              {minutesToLabel(m)}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: "0.5rem", gap: "0.6rem" }}>
          <label className="micro" htmlFor="custom_time" style={{ whiteSpace: "nowrap" }}>
            上にない時刻
          </label>
          <input
            id="custom_time"
            type="time"
            step={900}
            className="field"
            style={{ width: "auto" }}
            value={customTime || (slots.includes(startMin) ? "" : minutesToLabel(startMin))}
            onChange={(e) => {
              if (!e.target.value) return;
              setCustomTime(e.target.value);
              setStartMin(labelToMinutes(e.target.value));
            }}
          />
        </div>
      </div>

      {/* 人数 */}
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
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            className="field"
            style={{ width: "6.5rem" }}
            value={partySize}
            onChange={(e) => changeParty(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            aria-label="人数（11名以上）"
          />
          <span className="micro" style={{ alignSelf: "center" }}>
            名
          </span>
        </div>

        {remaining !== null ? (
          <p className={remaining < 0 ? "err" : "micro"} style={{ marginTop: "0.45rem" }}>
            {remaining < 0
              ? `定員を ${-remaining} 名超えています（定員 ${day.event_capacity} 名）`
              : `この予約を入れると 残り ${remaining} 名（定員 ${day.event_capacity} 名）`}
          </p>
        ) : null}
      </div>

      {/* お客様 */}
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

      <div>
        <label className="field-label" htmlFor="customer_kana">
          カナ（任意）
        </label>
        <input
          id="customer_kana"
          className="field"
          value={kana ?? ""}
          onChange={(e) => setKana(e.target.value)}
        />
      </div>

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

      {/* 流入元 ─ 既定値を置かない。選ばないと保存できない。 */}
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

      {/* 席 ─ 必須。「指定なし」も選択のうち。7名様以上は複数選べる。 */}
      {!isEvent ? (
        <div>
          <label className="field-label">
            席<span className="req">必須</span>
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
          <p className="micro" style={{ marginTop: "0.35rem" }}>
            {multiAllowed
              ? "7名様以上なので、席をつなげて複数選べます。"
              : "席の重複チェックはまだ入りません（Phase 2 で入ります）。"}
          </p>
        </div>
      ) : null}

      {/* コース */}
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

      <label className="switch">
        <span>飲み放題あり</span>
        <input
          type="checkbox"
          checked={drinkPlan}
          onChange={(e) => setDrinkPlan(e.target.checked)}
        />
      </label>

      <div>
        <label className="field-label" htmlFor="allergy">
          アレルギー・苦手なもの（任意）
        </label>
        <input
          id="allergy"
          className="field"
          value={allergy ?? ""}
          onChange={(e) => setAllergy(e.target.value)}
        />
      </div>

      <div>
        <label className="field-label" htmlFor="memo">
          メモ（任意）
        </label>
        <textarea
          id="memo"
          className="field"
          placeholder="お祝い・領収書の宛名・常連さん など"
          value={memo ?? ""}
          onChange={(e) => setMemo(e.target.value)}
        />
      </div>

      {error ? <p className="err">{error}</p> : null}

      {!editing ? (
        <label className="switch">
          <span>続けて次の予約を登録する</span>
          <input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} />
        </label>
      ) : null}

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? "保存中" : editing ? "変更を保存" : "この内容で登録"}
      </button>
    </form>
  );
}
