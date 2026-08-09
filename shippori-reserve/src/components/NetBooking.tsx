"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { minutesToLabel, WEEKDAY_JA } from "@/lib/time";

/**
 * お客様向けネット予約（ログイン不要）。
 * 人数 → 日付 → 時間 → お客様情報 → 確認 → 完了 の1画面ウィザード。
 * 空席はすべて /api/public/availability に聞く（判定ロジックはサーバーだけが持つ）。
 */

const TEL = "0897-47-4494";
const TEL_HREF = "tel:0897474494";

type DayCell = { date: string; status: "ok" | "few" | "full" | "closed" | "out" };
type Slot = { min: number; ok: boolean };
type DayInfo = { status: string; is_event: boolean; event_name: string | null; slots: Slot[] };

const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return ymOf(d);
};
const jaDate = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  const w = WEEKDAY_JA[new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日(${w})`;
};

export default function NetBooking() {
  const thisYm = ymOf(new Date());
  const maxYm = addMonths(thisYm, 2);

  const [party, setParty] = useState(2);
  const [ym, setYm] = useState(thisYm);
  const [days, setDays] = useState<DayCell[]>([]);
  const [monthLoading, setMonthLoading] = useState(true);
  const [date, setDate] = useState<string | null>(null);
  const [dayInfo, setDayInfo] = useState<DayInfo | null>(null);
  const [min, setMin] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [kana, setKana] = useState("");
  const [phone, setPhone] = useState("");
  const [memo, setMemo] = useState("");
  const [website, setWebsite] = useState(""); // ハニーポット（見えない欄）

  const [step, setStep] = useState<"pick" | "confirm" | "done">("pick");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [doneRef, setDoneRef] = useState("");

  const formRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);

  const loadMonth = useCallback(async (targetYm: string, targetParty: number) => {
    setMonthLoading(true);
    try {
      const res = await fetch(`/api/public/availability?ym=${targetYm}&party=${targetParty}`);
      const data = await res.json();
      setDays(Array.isArray(data.days) ? data.days : []);
    } catch {
      setDays([]);
    }
    setMonthLoading(false);
  }, []);

  const loadDay = useCallback(async (targetDate: string, targetParty: number) => {
    setDayInfo(null);
    try {
      const res = await fetch(`/api/public/availability?date=${targetDate}&party=${targetParty}`);
      setDayInfo(await res.json());
    } catch {
      setDayInfo(null);
    }
  }, []);

  useEffect(() => {
    loadMonth(ym, party);
  }, [ym, party, loadMonth]);

  const pickParty = (n: number) => {
    setParty(n);
    setDate(null);
    setDayInfo(null);
    setMin(null);
  };

  const pickDate = (d: DayCell) => {
    if (d.status !== "ok" && d.status !== "few") return;
    setDate(d.date);
    setMin(null);
    loadDay(d.date, party);
    setTimeout(() => timeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  const pickMin = (m: number) => {
    setMin(m);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  const canConfirm =
    date !== null && min !== null && name.trim() !== "" && phone.replace(/[^0-9]/g, "").length >= 10;

  const submit = async () => {
    if (date === null || min === null || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/public/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date,
          start_min: min,
          party,
          name,
          kana,
          phone,
          memo,
          website,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setDoneRef(data.reference as string);
        setStep("done");
      } else {
        setError(data.error ?? "予約できませんでした。");
        if (data.code === "RETRY") {
          // たった今埋まった等。最新の空きを取り直して選び直してもらう
          setStep("pick");
          setMin(null);
          loadMonth(ym, party);
          if (date) loadDay(date, party);
        } else {
          setStep("pick");
        }
      }
    } catch {
      setError("通信に失敗しました。電波の良い場所でもう一度お試しください。");
      setStep("pick");
    }
    setSending(false);
  };

  // カレンダーの升目（1日の曜日ぶん頭を空ける）
  const grid = useMemo(() => {
    if (days.length === 0) return [];
    const [y, m] = ym.split("-").map(Number);
    const lead = new Date(y, m - 1, 1).getDay();
    return [...Array.from({ length: lead }, () => null), ...days] as (DayCell | null)[];
  }, [days, ym]);

  const [yy, mm] = ym.split("-").map(Number);

  /* ── 完了画面 ── */
  if (step === "done") {
    return (
      <div className="net__card net__done">
        <p className="net__done-mark">🎉</p>
        <h2>ご予約ありがとうございます</h2>
        <p className="net__done-lead">ご予約が確定しました。ご来店をお待ちしております。</p>
        <div className="net__ref">
          <span className="net__ref-label">予約番号</span>
          <span className="net__ref-num">{doneRef}</span>
        </div>
        <dl className="net__summary">
          <div><dt>日時</dt><dd>{date && jaDate(date)} {min !== null && minutesToLabel(min)}</dd></div>
          <div><dt>人数</dt><dd>{party}名様</dd></div>
          <div><dt>お名前</dt><dd>{name.trim()} 様</dd></div>
        </dl>
        <div className="net__note">
          <p><b>予約番号をお控えください</b>（スクリーンショット推奨）。</p>
          <p>キャンセル・人数変更は <a href="/yoyaku/cancel">こちらのページ</a>（開始2時間前まで）または お電話（<a href={TEL_HREF}>{TEL}</a>）で承ります。</p>
        </div>
      </div>
    );
  }

  /* ── 確認画面 ── */
  if (step === "confirm") {
    return (
      <div className="net__card">
        <h2 className="net__step-title">ご予約内容の確認</h2>
        <dl className="net__summary net__summary--big">
          <div><dt>日時</dt><dd>{date && jaDate(date)} {min !== null && minutesToLabel(min)}〜</dd></div>
          <div><dt>人数</dt><dd>{party}名様</dd></div>
          <div><dt>お名前</dt><dd>{name.trim()}{kana.trim() ? `（${kana.trim()}）` : ""} 様</dd></div>
          <div><dt>電話番号</dt><dd>{phone}</dd></div>
          {memo.trim() && <div><dt>ご要望</dt><dd>{memo.trim()}</dd></div>}
        </dl>
        <p className="net__fineprint">
          お席は当店にお任せいただきます（ご要望があれば上のメモへ）。
          キャンセルは開始2時間前までWebで、それ以降はお電話でお願いします。
        </p>
        {error && <p className="net__error">{error}</p>}
        <div className="net__btnrow">
          <button className="btn" onClick={() => setStep("pick")} disabled={sending}>戻る</button>
          <button className="btn btn-primary net__grow" onClick={submit} disabled={sending}>
            {sending ? "送信中…" : "この内容で予約する"}
          </button>
        </div>
      </div>
    );
  }

  /* ── 入力画面 ── */
  return (
    <div className="net__flow">
      {error && <p className="net__error">{error}</p>}

      <section className="net__card">
        <h2 className="net__step-title"><span className="net__no">1</span>人数</h2>
        <div className="net__chips">
          {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              className={`net__chip${party === n ? " net__chip--on" : ""}`}
              onClick={() => pickParty(n)}
            >
              {n}名
            </button>
          ))}
        </div>
        <p className="net__hint">
          9名様以上・宴会コース・貸切のご相談は お電話（<a href={TEL_HREF}>{TEL}</a>）で承ります。
        </p>
      </section>

      <section className="net__card">
        <h2 className="net__step-title"><span className="net__no">2</span>日付</h2>
        <div className="net__monthnav">
          <button
            className="btn"
            onClick={() => setYm(addMonths(ym, -1))}
            disabled={ym <= thisYm}
            aria-label="前の月"
          >‹</button>
          <span className="net__month">{yy}年{mm}月</span>
          <button
            className="btn"
            onClick={() => setYm(addMonths(ym, 1))}
            disabled={ym >= maxYm}
            aria-label="次の月"
          >›</button>
        </div>
        <div className="net__cal">
          {WEEKDAY_JA.map((w, i) => (
            <span key={w} className={`net__dow${i === 0 ? " net__dow--sun" : i === 6 ? " net__dow--sat" : ""}`}>{w}</span>
          ))}
          {grid.map((d, i) =>
            d === null ? (
              <span key={`sp-${i}`} />
            ) : (
              <button
                key={d.date}
                className={`net__day net__day--${d.status}${date === d.date ? " net__day--sel" : ""}`}
                onClick={() => pickDate(d)}
                disabled={d.status !== "ok" && d.status !== "few"}
              >
                <span className="net__day-n">{Number(d.date.slice(8))}</span>
                <span className="net__day-m">
                  {d.status === "ok" ? "◯" : d.status === "few" ? "△" : d.status === "closed" ? "休" : d.status === "full" ? "×" : ""}
                </span>
              </button>
            ),
          )}
        </div>
        {monthLoading && <p className="net__hint">空席を確認しています…</p>}
        <p className="net__hint">◯ 空席あり ／ △ 残りわずか ／ × 満席 ／ 休 定休日（火曜）。当日は開始2時間前まで承ります。</p>
      </section>

      <section className="net__card" ref={timeRef}>
        <h2 className="net__step-title"><span className="net__no">3</span>時間{date && <span className="net__picked">{jaDate(date)}</span>}</h2>
        {date === null ? (
          <p className="net__hint">先に日付をお選びください。</p>
        ) : dayInfo === null ? (
          <p className="net__hint">空き時間を確認しています…</p>
        ) : (
          <>
            {dayInfo.is_event && (
              <p className="net__event">この日は「{dayInfo.event_name ?? "イベント営業"}」です（18:00〜24:00・お席は自由です）。</p>
            )}
            <div className="net__chips">
              {dayInfo.slots.map((s) => (
                <button
                  key={s.min}
                  className={`net__chip${min === s.min ? " net__chip--on" : ""}`}
                  disabled={!s.ok}
                  onClick={() => pickMin(s.min)}
                >
                  {minutesToLabel(s.min)}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="net__card" ref={formRef}>
        <h2 className="net__step-title"><span className="net__no">4</span>お客様情報</h2>
        <label className="net__label" htmlFor="net-name">お名前 <em>必須</em></label>
        <input id="net-name" className="field" value={name} maxLength={40}
          onChange={(e) => setName(e.target.value)} placeholder="例）山内" autoComplete="name" />
        <label className="net__label" htmlFor="net-kana">フリガナ</label>
        <input id="net-kana" className="field" value={kana} maxLength={40}
          onChange={(e) => setKana(e.target.value)} placeholder="例）ヤマウチ" />
        <label className="net__label" htmlFor="net-phone">電話番号 <em>必須</em></label>
        <input id="net-phone" className="field" value={phone} inputMode="tel" maxLength={13}
          onChange={(e) => setPhone(e.target.value)} placeholder="例）090-1234-5678" autoComplete="tel" />
        <label className="net__label" htmlFor="net-memo">ご要望（任意）</label>
        <textarea id="net-memo" className="field" value={memo} maxLength={200} rows={3}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="アレルギー・お祝い・掘りごたつ希望 など" />
        {/* ボット対策。人間には見えない */}
        <input
          type="text"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
        />
        <button
          className="btn btn-primary net__confirm-btn"
          disabled={!canConfirm}
          onClick={() => { setError(""); setStep("confirm"); }}
        >
          予約内容を確認する
        </button>
        {!canConfirm && (
          <p className="net__hint">日付・時間を選び、お名前と電話番号をご入力ください。</p>
        )}
      </section>

      <p className="net__foot">
        ご予約の確認・キャンセルは <a href="/yoyaku/cancel">こちら</a>。
        お急ぎの場合は お電話（<a href={TEL_HREF}>{TEL}</a>）へどうぞ。
      </p>
    </div>
  );
}
