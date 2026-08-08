"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SOURCES } from "@/lib/constants";
import {
  fmtDateJa,
  isoToMinutes,
  minutesToLabel,
  shiftDate,
  timeSlots,
  todayBizDate,
} from "@/lib/time";
import type { Course, DailySummary, Profile, Reservation, SeatUnit } from "@/lib/types";
import type { ActionResult, ReservationInput } from "@/app/(app)/reservations/actions";

type Props = {
  /** 編集なら既存の予約。新規なら undefined。 */
  reservation?: Reservation;
  initialDay: DailySummary;
  ownerContacts: Profile[];
  courses: Course[];
  seatUnits: SeatUnit[];
  /** 新規登録時の初期日付 */
  defaultDate: string;
  onSubmit: (input: ReservationInput) => Promise<ActionResult>;
};

const PARTY_CHIPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export default function ReservationForm({
  reservation,
  initialDay,
  ownerContacts,
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
  const [kana, setKana] = useState(reservation?.customer_kana ?? "");
  const [phone, setPhone] = useState(reservation?.phone ?? "");
  const [source, setSource] = useState<ReservationInput["source"]>(reservation?.source ?? "");
  const [ownerId, setOwnerId] = useState(reservation?.source_profile_id ?? "");
  const [seatNote, setSeatNote] = useState(reservation?.seat_note ?? "");
  const [courseId, setCourseId] = useState(reservation?.course_id ?? "");
  const [drinkPlan, setDrinkPlan] = useState(reservation?.drink_plan ?? false);
  const [allergy, setAllergy] = useState(reservation?.allergy ?? "");
  const [memo, setMemo] = useState(reservation?.memo ?? "");
  const [again, setAgain] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isEvent = day.mode === "event";

  /*
   * 日付を変えたら、その日の営業設定を取り直す。
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
        // 新しい日の営業時間の外にいたら開店時刻に寄せる
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

  function submit() {
    setError(null);

    const input: ReservationInput = {
      biz_date: bizDate,
      start_min: startMin,
      party_size: partySize,
      customer_name: name,
      customer_kana: kana,
      phone,
      source,
      source_profile_id: ownerId,
      seat_note: isEvent ? "" : seatNote,
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
        setSeatNote("");
        setMemo("");
        setAllergy("");
        setPartySize(2);
        router.refresh();
      } else {
        router.push(`/?d=${bizDate}`);
      }
      router.refresh();
    });
  }

  const slots = timeSlots(day.open_min, day.close_min);

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

      {/* 1. 日付 ─ 電話で聞く順に並べる */}
      <div>
        <label className="field-label">
          日付<span className="req">必須</span>
        </label>
        <div className="chips">
          <button
            type="button"
            className="chip"
            aria-pressed={bizDate === todayBizDate()}
            onClick={() => setBizDate(todayBizDate())}
          >
            今日
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={bizDate === shiftDate(todayBizDate(), 1)}
            onClick={() => setBizDate(shiftDate(todayBizDate(), 1))}
          >
            明日
          </button>
          <input
            type="date"
            className="field"
            style={{ width: "auto", flex: "1 1 10rem" }}
            value={bizDate}
            onChange={(e) => e.target.value && setBizDate(e.target.value)}
          />
        </div>
        <p className="micro" style={{ marginTop: "0.35rem" }}>
          {fmtDateJa(bizDate)}・{isEvent ? "イベント営業" : "通常営業"}
          {day.is_busy ? "・繁忙日" : ""}
        </p>
      </div>

      {/* 2. 時刻 */}
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
        </div>
      </div>

      {/* 3. 人数 */}
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
              onClick={() => setPartySize(n)}
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
            onChange={(e) => setPartySize(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
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

      {/* 4-5. お客様 */}
      <div>
        <label className="field-label" htmlFor="customer_name">
          お名前<span className="req">必須</span>
        </label>
        <input
          id="customer_name"
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
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

      {/* 6. 流入元 ─ 既定値を置かない。選ばないと保存できない。 */}
      <div>
        <label className="field-label">
          どこから来た予約か<span className="req">必須</span>
        </label>
        <div className="chips">
          {SOURCES.map((s) => (
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

        {source === "owner_direct" ? (
          <div style={{ marginTop: "0.6rem" }}>
            <label className="field-label" htmlFor="owner">
              どのオーナー経由か<span className="req">必須</span>
            </label>
            <select
              id="owner"
              className="field"
              value={ownerId ?? ""}
              onChange={(e) => setOwnerId(e.target.value)}
            >
              <option value="">選んでください</option>
              {ownerContacts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.display_name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {/* 7. 席 ─ Phase 1 はメモ。重複判定は Phase 2 で入れる。 */}
      {!isEvent ? (
        <div>
          <label className="field-label" htmlFor="seat_note">
            席（任意・メモ）
          </label>
          <div className="chips" style={{ marginBottom: "0.45rem" }}>
            {seatUnits.map((u) => (
              <button
                key={u.id}
                type="button"
                className="chip"
                aria-pressed={seatNote === u.name}
                onClick={() => setSeatNote(seatNote === u.name ? "" : u.name)}
              >
                {u.name}
                <span className="micro" style={{ marginLeft: "0.3rem" }}>
                  {u.capacity}
                </span>
              </button>
            ))}
          </div>
          <input
            id="seat_note"
            className="field"
            placeholder="例：テーブル2卓つなげて"
            value={seatNote ?? ""}
            onChange={(e) => setSeatNote(e.target.value)}
          />
          <p className="micro" style={{ marginTop: "0.35rem" }}>
            いまは席の重複チェックはしません（Phase 2 で入ります）。
          </p>
        </div>
      ) : null}

      {/* 8. コース */}
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
