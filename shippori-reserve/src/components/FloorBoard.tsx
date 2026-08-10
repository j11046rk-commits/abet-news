"use client";

import { useEffect, useRef, useState } from "react";
import { fmtDateShort, startLabel } from "@/lib/time";
import { getBoardSnapshot, setSeatState, type BoardSnapshot } from "@/app/(app)/board/actions";
import { seatKind } from "@/lib/seats";

/**
 * 席ボード（タブレット常設用）。
 * 実店舗の配置どおり：左=和室（掘りごたつ・両側4人掛け）・中央=L型カウンター10席・右=6名掛けテーブル×3。
 * フロア図は 1000×430 の固定キャンバスを画面幅に合わせて等倍で縮小拡大する——
 * 1枚の絵と同じ扱いなので、端末や画面サイズが変わっても配置は一切崩れない。
 * カウンターは丸椅子を1席ずつタップ（C1〜C10）。卓は1タップで使用中⇔空き。
 * 新しいネット予約は音つきの全画面お知らせ（タップで確認するまで消えない）。
 */

const POLL_MS = 15_000;

/** 固定キャンバスの設計サイズ */
const CANVAS_W = 1000;
const CANVAS_H = 430;
const STOOL = 46; // 丸椅子の直径

// カウンターの椅子は長手も短手も中心間60pxで統一
/** 横バーの上に並ぶ1〜7番（左から） */
const STOOLS_TOP = [1, 2, 3, 4, 5, 6, 7].map((n, i) => ({ n, x: 260 + i * 60 - STOOL / 2, y: 28 }));
/** L字に折れた縦バーの右に並ぶ8〜10番（上から） */
const STOOLS_SIDE = [8, 9, 10].map((n, i) => ({ n, x: 657, y: 132 + i * 60 }));
/** テーブル3卓の枠位置 */
const TABLES = [
  { key: "T1", x: 715 },
  { key: "T2", x: 810 },
  { key: "T3", x: 905 },
];

export default function FloorBoard({ initial }: { initial: BoardSnapshot }) {
  const [date, setDate] = useState(initial.date);
  const [board, setBoard] = useState<Record<string, number>>(initial.board);
  const [resv, setResv] = useState(initial.reservations);
  const [alerts, setAlerts] = useState<BoardSnapshot["reservations"]>([]);
  const [saving, setSaving] = useState(false);

  const seenIds = useRef<Set<string>>(new Set(initial.recent_net.map((r) => r.id)));
  const audioCtx = useRef<AudioContext | null>(null);

  // デジタル時計。秒まで動かして「画面が生きている」ことが分かるように（店主の希望）
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("ja-JP", { hour12: false }));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  // キャンバスの縮尺。枠の幅に合わせて等倍で縮小・拡大する。
  // 途中で止めると端が隠れてしまうので、どんなに狭い画面でも図の全体が必ず収まるようにする
  const floorRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = floorRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth - 18; // 枠のパディング分
      setScale(Math.min(w / CANVAS_W, 1.2));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  /** カウンターの丸椅子（C1〜C10）。座ったらその席をタップ、帰ったらもう一度 */
  const stoolOn = (n: number) => (board[`C${n}`] ?? 0) > 0;
  const toggleStool = (n: number) => save(`C${n}`, stoolOn(n) ? 0 : 1);

  const counterUsed = [...STOOLS_TOP, ...STOOLS_SIDE].filter((s) => stoolOn(s.n)).length;
  const zashikiOn = (board["和室"] ?? 0) > 0;
  const tablesFree = TABLES.filter((t) => !((board[t.key] ?? 0) > 0)).length;
  /** いま席ボード上で空いている席数＝飛び込みを受け入れられる目安 */
  const freeSeats = 10 - counterUsed + tablesFree * 6 + (zashikiOn ? 0 : 8);
  const guests = resv.reduce((a, r) => a + r.party_size, 0);

  const stoolBtn = ({ n, x, y }: { n: number; x: number; y: number }) => (
    <button
      key={n}
      className={`fb__stool${stoolOn(n) ? " fb__stool--on" : ""}`}
      style={{ left: x, top: y, width: STOOL, height: STOOL }}
      onClick={() => toggleStool(n)}
      aria-pressed={stoolOn(n)}
      aria-label={`カウンター${n}番`}
    >
      {n}
    </button>
  );

  const tableCard = ({ key, x }: { key: string; x: number }) => {
    const on = (board[key] ?? 0) > 0;
    return (
      <button
        key={key}
        className={`fb__table${on ? " fb__table--on" : ""}`}
        style={{ left: x, top: 120, width: 84, height: 270 }}
        onClick={() => toggleUnit(key)}
        aria-pressed={on}
      >
        <span className="fbc__tcol">
          {Array.from({ length: 3 }, (_, i) => (
            <i key={i} />
          ))}
        </span>
        <span className="fb__ttop">
          <b>{key}</b>
          <small>6名掛け</small>
          <em className="fb__state">{on ? "使用中" : "空き"}</em>
        </span>
        <span className="fbc__tcol">
          {Array.from({ length: 3 }, (_, i) => (
            <i key={i} />
          ))}
        </span>
      </button>
    );
  };

  return (
    <div className="fbwrap">
      <div className="fb">
        <header className="fb__head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-face.png" alt="しっぽり亭" className="fb__logo" />
          <h1>席ボード</h1>
          <p className="fb__date">{date.replaceAll("-", "/")}</p>
          {clock && (
            <p className="fb__clock" aria-label="現在時刻">
              {clock}
            </p>
          )}
          <p className="fb__cap" aria-label="いま受け入れできる人数">
            受入可 <b>{freeSeats}</b> 名
          </p>
          <p className="fb__sum">
            予約 {resv.length}組 {guests}名 ／ カウンター使用 {counterUsed}席
          </p>
          {saving && <span className="fb__saving">保存中…</span>}
        </header>

        <div className="fb__body">
          <div className="fb__floor" ref={floorRef}>
            <div style={{ position: "relative", width: CANVAS_W * scale, height: CANVAS_H * scale }}>
              <div
                className="fb__canvas"
                style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})` }}
              >
                {/* 和室（掘りごたつ・両側4人掛け） */}
                <button
                  className={`fb__zashiki${zashikiOn ? " fb__zashiki--on" : ""}`}
                  style={{ left: 12, top: 20, width: 190, height: 390 }}
                  onClick={() => toggleUnit("和室")}
                  aria-pressed={zashikiOn}
                >
                  <span className="fbc__zrow">
                    <span className="fbc__chaircol">
                      {Array.from({ length: 4 }, (_, i) => (
                        <i key={i} />
                      ))}
                    </span>
                    <span className="fb__ztable">
                      <b>和室</b>
                      <small>個室・8名掛け</small>
                      <em className="fb__state">{zashikiOn ? "使用中" : "空き"}</em>
                    </span>
                    <span className="fbc__chaircol">
                      {Array.from({ length: 4 }, (_, i) => (
                        <i key={i} />
                      ))}
                    </span>
                  </span>
                </button>

                {/* L型カウンター：横バー＋右端から下へ折れる縦バー */}
                <div className="fb__hbar" style={{ left: 235, top: 90, width: 410, height: 42 }}>
                  カウンター（残り{10 - counterUsed}席）
                </div>
                <div className="fb__vbar" style={{ left: 603, top: 131, width: 42, height: 201 }} />
                {STOOLS_TOP.map(stoolBtn)}
                {STOOLS_SIDE.map(stoolBtn)}
                <p className="fb__hint" style={{ left: 235, top: 352, width: 350 }}>
                  座った席をタップ（帰ったらもう一度タップで空きに戻る）
                </p>

                {/* ホール（歩く場所）は席がないので、ここに屋号の徳利を薄く置く */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo-face.png"
                  alt=""
                  className="fb__mark"
                  style={{ left: 300, top: 175, width: 150, height: 150 }}
                />

                {/* テーブル3卓 */}
                {TABLES.map(tableCard)}
              </div>
            </div>
          </div>

          <aside className="fb__side">
            <h2>今日の予約</h2>
            {resv.length === 0 ? (
              <p className="fb__empty">今日の予約はまだありません</p>
            ) : (
              <ul className="fb__list">
                {resv.map((r) => {
                  const kind = seatKind(r.seat_note);
                  return (
                    <li key={r.id} className={kind ? `fb__li--${kind}` : ""}>
                      <span className="fb__time">
                        {startLabel({ biz_date: date, starts_at: r.starts_at })}
                      </span>
                      <span className="fb__name">
                        {r.customer_name} 様 {r.party_size}名
                      </span>
                      <span className="fb__seat">{r.seat_note ?? ""}</span>
                      {r.source === "web_form" && <span className="fb__hp">HP</span>}
                    </li>
                  );
                })}
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
    </div>
  );
}
