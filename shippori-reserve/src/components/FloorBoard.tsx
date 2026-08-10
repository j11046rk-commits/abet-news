"use client";

import { useEffect, useRef, useState } from "react";
import { fmtDateShort, startLabel } from "@/lib/time";
import { getBoardSnapshot, setSeatState, type BoardSnapshot } from "@/app/(app)/board/actions";

/**
 * 席ボード（タブレット常設用）。
 * 実店舗の並びを模した簡易フロア図：和室（8名）・カウンター10席・6名掛けテーブル×3。
 * 飛び込みが座ったらタップ、帰ったらもう一度タップ。それだけ。
 * 新しいネット予約は音つきの全画面お知らせ（タップで確認するまで消えない）。
 */

const POLL_MS = 15_000;

export default function FloorBoard({ initial }: { initial: BoardSnapshot }) {
  const [date, setDate] = useState(initial.date);
  const [board, setBoard] = useState<Record<string, number>>(initial.board);
  const [resv, setResv] = useState(initial.reservations);
  const [alerts, setAlerts] = useState<BoardSnapshot["reservations"]>([]);
  const [saving, setSaving] = useState(false);

  const seenIds = useRef<Set<string>>(new Set(initial.recent_net.map((r) => r.id)));
  const audioCtx = useRef<AudioContext | null>(null);

  // 音はブラウザの決まりで「一度画面に触れた後」しか鳴らせない。最初のタップで準備する
  useEffect(() => {
    const arm = () => {
      if (!audioCtx.current) {
        try {
          audioCtx.current = new AudioContext();
        } catch {
          /* 音なしでも動く */
        }
      }
    };
    document.addEventListener("pointerdown", arm, { once: true });
    return () => document.removeEventListener("pointerdown", arm);
  }, []);

  const beep = () => {
    const ctx = audioCtx.current;
    if (!ctx) return;
    try {
      const t = ctx.currentTime;
      [0, 0.18, 0.36].forEach((off, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = i === 2 ? 1320 : 880;
        gain.gain.setValueAtTime(0.001, t + off);
        gain.gain.exponentialRampToValueAtTime(0.3, t + off + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + off + 0.15);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t + off);
        osc.stop(t + off + 0.16);
      });
    } catch {
      /* 音が出なくても表示は出る */
    }
  };

  // 15秒ごとに最新化。新しいネット予約が来ていたらお知らせに積む
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const snap = await getBoardSnapshot();
        if (snap.date !== date) {
          // 営業日が変わった＝ボードはまっさら。お知らせも仕切り直し
          seenIds.current = new Set(snap.recent_net.map((r) => r.id));
          setDate(snap.date);
        } else {
          // 未来日も含む「新しく入ったネット予約」を拾う
          const fresh = snap.recent_net.filter((r) => !seenIds.current.has(r.id));
          snap.recent_net.forEach((r) => seenIds.current.add(r.id));
          if (fresh.length > 0) {
            setAlerts((prev) => [...prev, ...fresh]);
          }
        }
        setBoard(snap.board);
        setResv(snap.reservations);
      } catch {
        /* 次の周回で取り直す */
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [date]);

  // お知らせが出ている間は繰り返し鳴らして気づかせる
  useEffect(() => {
    if (alerts.length === 0) return;
    beep();
    const timer = setInterval(beep, 5_000);
    return () => clearInterval(timer);
  }, [alerts.length]);

  async function save(key: string, value: number) {
    const prev = board[key] ?? 0;
    setBoard((b) => ({ ...b, [key]: value }));
    setSaving(true);
    const res = await setSeatState(key, value);
    setSaving(false);
    if (!res.ok) setBoard((b) => ({ ...b, [key]: prev }));
  }

  const toggleUnit = (key: string) => save(key, (board[key] ?? 0) > 0 ? 0 : 1);

  /** カウンターの丸椅子。左から詰めて数える。p席目をタップ→そこまで埋める/そこから空ける */
  const tapStool = (p: number) => {
    const cur = board["C"] ?? 0;
    save("C", p <= cur ? p - 1 : p);
  };

  const counterUsed = board["C"] ?? 0;
  const guests = resv.reduce((a, r) => a + r.party_size, 0);

  const unitCard = (key: string, label: string, seats: number, kind: "table" | "room") => {
    const on = (board[key] ?? 0) > 0;
    return (
      <button
        key={key}
        className={`fb__unit fb__unit--${kind}${on ? " fb__unit--on" : ""}`}
        onClick={() => toggleUnit(key)}
        aria-pressed={on}
      >
        <span className="fb__chairs fb__chairs--top">
          {Array.from({ length: Math.ceil(seats / 2) }, (_, i) => (
            <i key={i} />
          ))}
        </span>
        <span className="fb__tabletop">
          <b>{label}</b>
          <small>{seats}名掛け</small>
          <em>{on ? "使用中" : "空き"}</em>
        </span>
        <span className="fb__chairs fb__chairs--btm">
          {Array.from({ length: Math.floor(seats / 2) }, (_, i) => (
            <i key={i} />
          ))}
        </span>
      </button>
    );
  };

  return (
    <div className="fb">
      <header className="fb__head">
        <h1>席ボード</h1>
        <p className="fb__date">{date.replaceAll("-", "/")}</p>
        <p className="fb__sum">
          予約 {resv.length}組 {guests}名 ／ カウンター使用 {counterUsed}席
        </p>
        {saving && <span className="fb__saving">保存中…</span>}
      </header>

      <div className="fb__body">
        <div className="fb__floor">
          <div className="fb__row">
            {unitCard("和室", "和室", 8, "room")}
            <div className="fb__tables">
              {unitCard("T1", "T1", 6, "table")}
              {unitCard("T2", "T2", 6, "table")}
              {unitCard("T3", "T3", 6, "table")}
            </div>
          </div>

          <div className="fb__counter">
            <p className="fb__counter-label">
              カウンター <b>残り{10 - counterUsed}席</b>
            </p>
            <div className="fb__stools">
              {Array.from({ length: 10 }, (_, i) => {
                const p = i + 1;
                const on = p <= counterUsed;
                return (
                  <button
                    key={p}
                    className={`fb__stool${on ? " fb__stool--on" : ""}`}
                    onClick={() => tapStool(p)}
                    aria-label={`カウンター${p}席目`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
            <p className="fb__hint">座った席の数だけ左からタップ（帰ったら減らす）</p>
          </div>
        </div>

        <aside className="fb__side">
          <h2>今日の予約</h2>
          {resv.length === 0 ? (
            <p className="fb__empty">今日の予約はまだありません</p>
          ) : (
            <ul className="fb__list">
              {resv.map((r) => (
                <li key={r.id}>
                  <span className="fb__time">{startLabel({ biz_date: date, starts_at: r.starts_at })}</span>
                  <span className="fb__name">
                    {r.customer_name} 様 {r.party_size}名
                  </span>
                  <span className="fb__seat">{r.seat_note ?? ""}</span>
                  {r.source === "web_form" && <span className="fb__hp">HP</span>}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {alerts.length > 0 && (
        <div className="fb__alert" role="alertdialog">
          <div className="fb__alert-card">
            <p className="fb__alert-title">新しいネット予約</p>
            {alerts.map((a) => (
              <p key={a.id} className="fb__alert-line">
                <b>
                  {fmtDateShort(a.biz_date)} {startLabel(a)}
                </b>{" "}
                {a.customer_name} 様 {a.party_size}名（{a.seat_note ?? "席未定"}）
              </p>
            ))}
            <button className="btn btn-primary fb__alert-ok" onClick={() => setAlerts([])}>
              確認した
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
