"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { fmtDateShort, startLabel } from "@/lib/time";
import {
  getBoardSnapshot,
  setNetPause,
  setSeatState,
  type BoardSnapshot,
} from "@/app/(app)/board/actions";
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

/**
 * 固定キャンバスの設計サイズ。
 * 席は36個あるので、指で押せる大きさ（44px前後）を確保できる寸法にしてある。
 */
const CANVAS_W = 1240;
const CANVAS_H = 430;
const SEAT = 46; // 席1つの当たり判定

/** 和室（左）：座卓を挟んで奥に4席・手前に4席 */
const ZASHIKI = { x: 12, y: 24, w: 250, h: 300 };
const Z_SEATS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
  key: `Z${n}`,
  n,
  x: ZASHIKI.x + 22 + ((n - 1) % 4) * 54,
  y: n <= 4 ? ZASHIKI.y + 20 : ZASHIKI.y + ZASHIKI.h - 20 - SEAT,
}));

/** L型カウンター（中央）：横バーの上に1〜7番、折れた先の右に8〜10番 */
const C_TOP = [1, 2, 3, 4, 5, 6, 7].map((n, i) => ({ key: `C${n}`, n, x: 292 + i * 56, y: 30 }));
const C_SIDE = [8, 9, 10].map((n, i) => ({ key: `C${n}`, n, x: 700, y: 168 + i * 56 }));
const HBAR = { x: 292, y: 92, w: 396, h: 56 };
const VBAR = { x: 632, y: 148, w: 56, h: 172 };

/**
 * テーブル3卓（右）：天板を挟んで左右に3席ずつ。
 * 卓名は枠の上端に置く（天板に重ねると席番号と重なって読めない）。
 */
const T_W = 150;
const T_H = 230;
const TABLES = [
  { key: "T1", x: 766 },
  { key: "T2", x: 924 },
  { key: "T3", x: 1082 },
].map((t) => ({
  ...t,
  y: 96,
  w: T_W,
  h: T_H,
  top: { x: t.x + 52, y: 96 + 44, w: 46, h: 168 },
  seats: [1, 2, 3, 4, 5, 6].map((n) => ({
    key: `${t.key}-${n}`,
    n,
    x: n <= 3 ? t.x + 2 : t.x + T_W - 2 - SEAT,
    y: 96 + 44 + ((n - 1) % 3) * 62,
  })),
}));

export default function FloorBoard({ initial }: { initial: BoardSnapshot }) {
  const [date, setDate] = useState(initial.date);
  const [board, setBoard] = useState<Record<string, number>>(initial.board);
  const [resv, setResv] = useState(initial.reservations);
  // 予約から作った席の下書き（点線で出す）。DBには入っていない・毎回作り直される。
  const [planned, setPlanned] = useState(initial.planned);
  const [unplanned, setUnplanned] = useState(initial.unplanned);
  const [alerts, setAlerts] = useState<BoardSnapshot["reservations"]>([]);
  // お客様からのLINEメッセージ。ネット予約と同じ、音つきで消えないお知らせに積む
  const [lineAlerts, setLineAlerts] = useState<BoardSnapshot["line_msgs"]>([]);
  const [saving, setSaving] = useState(false);
  const [pause, setPause] = useState(initial.pause);
  const [askPause, setAskPause] = useState(false);
  const [openNow, setOpenNow] = useState(initial.open_now);

  const seenIds = useRef<Set<string>>(new Set(initial.recent_net.map((r) => r.id)));
  // 画面を開いた時点より前のメッセージは鳴らさない（開くたびに過去分が鳴ると狼少年になる）
  const seenMsgIds = useRef<Set<number>>(new Set(initial.line_msgs.map((m) => m.id)));
  const audioCtx = useRef<AudioContext | null>(null);

  // この時刻までは、取り直した席の状態を画面に当てない（自分のタップを守る猶予）。
  // 保存が終わってからも少し置くのは、保存より前に飛んでいった取り直しが
  // あとから返ってくることがあるため。
  const quietUntil = useRef(0);

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
          seenMsgIds.current = new Set(snap.line_msgs.map((m) => m.id));
          setDate(snap.date);
        } else {
          // 未来日も含む「新しく入ったネット予約」を拾う
          const fresh = snap.recent_net.filter((r) => !seenIds.current.has(r.id));
          snap.recent_net.forEach((r) => seenIds.current.add(r.id));
          if (fresh.length > 0) {
            setAlerts((prev) => [...prev, ...fresh]);
          }
          // お客様からのLINEメッセージも同じ扱いで積む
          const freshMsgs = snap.line_msgs.filter((m) => !seenMsgIds.current.has(m.id));
          snap.line_msgs.forEach((m) => seenMsgIds.current.add(m.id));
          if (freshMsgs.length > 0) {
            setLineAlerts((prev) => [...prev, ...freshMsgs]);
          }
        }
        // 席の状態は、いま自分が押した直後だけ上書きしない。
        // 取り直しは15秒に1回で、押してから保存が届くまでの間に返ってきた
        // 一周前の姿を当ててしまうと、点けたばかりの席がふっと消える。
        // 消えた席をもう一度押すと今度は逆に点く——お客様がいないのに使用中になる。
        if (quietUntil.current < Date.now()) setBoard(snap.board);
        setResv(snap.reservations);
        setPlanned(snap.planned);
        setUnplanned(snap.unplanned);
        setPause(snap.pause);
        setOpenNow(snap.open_now);
      } catch {
        /* 次の周回で取り直す */
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [date]);

  // お知らせが出ている間は繰り返し鳴らして気づかせる（予約もLINEメッセージも同じ）
  useEffect(() => {
    if (alerts.length === 0 && lineAlerts.length === 0) return;
    beep();
    const timer = setInterval(beep, 5_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts.length, lineAlerts.length]);

  async function save(key: string, value: number, reservationId?: string) {
    const prev = board[key] ?? 0;
    quietUntil.current = Date.now() + 8_000;
    setBoard((b) => ({ ...b, [key]: value }));
    setSaving(true);
    const res = await setSeatState(key, value, reservationId);
    setSaving(false);
    quietUntil.current = Date.now() + 5_000;
    if (!res.ok) setBoard((b) => ({ ...b, [key]: prev }));
  }

  /** ネット予約の受付を止める／再開する。押した時刻はそのまま記録に残る */
  async function switchPause(on: boolean) {
    setAskPause(false);
    setSaving(true);
    const res = await setNetPause(on);
    setSaving(false);
    if (!res.ok) return;
    const snap = await getBoardSnapshot();
    setPause(snap.pause);
  }

  /** 分を「◯時間◯分」に。0分のときは「0分」 */
  const hhmm = (min: number) =>
    min >= 60 ? `${Math.floor(min / 60)}時間${min % 60}分` : `${min}分`;

  // 停止中は経過時間を1分ごとに数え直して、止めっぱなしに気づけるようにする
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!pause.on) return;
    const timer = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [pause.on]);
  const pausedMin = pause.since
    ? Math.max(0, Math.round((Date.now() - new Date(pause.since).getTime()) / 60_000))
    : 0;

  /*
   * 席は3つの状態を持つ。
   *   空き   … 何も無い
   *   予約   … 予約から作った下書き（点線）。まだお客様は来ていない
   *   着席   … タップして点けた席（塗り）。実際に座っている
   *
   * 分けるのは、ボードを見て「あと何組まだ来ていないか」が分かるようにするため。
   * 予約ぶんを着席と同じ見た目にすると、開店直後から全部埋まって見えて、
   * 誰を待っているのかが画面から消える。
   *
   * 下書きの席は当日ズレる（お客様の希望・組の入れ替わり）。ズレたら
   * 点線を押して実際の席を点ける——それだけで直る作りにしてある。
   */
  const seatOn = (key: string) => (board[key] ?? 0) > 0;
  const seatPlanned = (key: string) => !seatOn(key) && planned[key] !== undefined;
  /*
   * 点線（予約の下書き）の席を点けるときだけ、「そのご予約のお客様か、
   * 別のお客様（飛び込み）か」を一度きく。
   *
   * きかずに無条件で予約に紐づけると、点線の席に飛び込みを座らせた場合、
   * まだ来ていない予約が「来店中」→飛び込みが帰った時点で「会計済」になり、
   * その席がネットに再販される——本物のお客様が来たとき席が無い（二重予約）。
   * タップが1回増えるのは点線の席だけで、ふつうの席は今までどおり1タップ。
   */
  const [askSeat, setAskSeat] = useState<string | null>(null);
  const toggleSeat = (key: string) => {
    if (seatOn(key)) return save(key, 0);
    if (planned[key] !== undefined) return setAskSeat(key);
    return save(key, 1);
  };

  // 「使用中」は着席と予約の両方を数える。予約ぶんを空きに数えると、
  // 飛び込みを受けたあとに予約のお客様の席が無くなる。
  const inUse = (key: string) => seatOn(key) || seatPlanned(key);
  const counterUsed = [...C_TOP, ...C_SIDE].filter((s) => inUse(s.key)).length;
  const zashikiUsed = Z_SEATS.filter((s) => inUse(s.key)).length;
  const tableUsed = (t: (typeof TABLES)[number]) => t.seats.filter((s) => inUse(s.key)).length;

  // 予約から見た卓の空きは「1席でも埋まっていれば満席」（店主指定）。
  // 席の空き数そのものは、飛び込みを何名まで受け入れられるかの目安に使う
  const freeSeats =
    10 -
    counterUsed +
    TABLES.reduce((a, t) => a + (tableUsed(t) > 0 ? 0 : 6), 0) +
    (zashikiUsed > 0 ? 0 : 8);
  const guests = resv.reduce((a, r) => a + r.party_size, 0);

  const seatBtn = (
    seat: { key: string; n: number; x: number; y: number },
    kind: "counter" | "table" | "room",
    label: string,
  ) => (
    <button
      key={seat.key}
      className={`fb__seat fb__seat--${kind}${seatOn(seat.key) ? " fb__seat--on" : ""}${
        seatPlanned(seat.key) ? " fb__seat--planned" : ""
      }`}
      style={{ left: seat.x, top: seat.y, width: SEAT, height: SEAT }}
      onClick={() => toggleSeat(seat.key)}
      aria-pressed={seatOn(seat.key)}
      aria-label={
        seatPlanned(seat.key)
          ? `${label}（${planned[seat.key]?.label} 様のご予約・まだご来店前）`
          : label
      }
      title={seatPlanned(seat.key) ? `${planned[seat.key]?.label} 様（予約）` : undefined}
    >
      {seatPlanned(seat.key) ? (
        <span className="fb__seat-name">{planned[seat.key]?.label}</span>
      ) : (
        seat.n
      )}
    </button>
  );

  return (
    <div className="fbwrap">
      <div className="fb">
        <header className="fb__head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-face-96.png" alt="しっぽり亭" width={96} height={96} className="fb__logo" />
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
          {pause.on ? (
            <button className="fb__pausebtn fb__pausebtn--on" onClick={() => switchPause(false)}>
              受付を再開する
            </button>
          ) : (
            <button
              className="fb__pausebtn"
              onClick={() => setAskPause(true)}
              disabled={!openNow}
              title={openNow ? undefined : "営業時間中だけ使えます"}
            >
              新規予約停止
            </button>
          )}
          <p className="fb__sum">
            予約 {resv.length}組 {guests}名 ／ カウンター使用 {counterUsed}席
          </p>
          {saving && <span className="fb__saving">保存中…</span>}
        </header>

        {/*
          下書きで席が決まらなかった予約。黙って落とすと、数が合わないことに
          誰も気づかないまま当日を迎える。名指しで出して、手で置いてもらう。
        */}
        {unplanned.length > 0 && (
          <p className="fb__nofit">
            席が決まっていないご予約が {unplanned.length}組：
            {unplanned.map((u) => ` ${u.label}様（${u.party}名）`).join("・")}
            {" "}— 空いている席をタップして置いてください。
          </p>
        )}

        {pause.on && (
          <div className="fb__paused" role="status">
            <span className="fb__paused-dot" />
            <b>本日のネット予約を停止中</b>
            <span className="fb__paused-min">{hhmm(pausedMin)}経過</span>
            <span className="fb__paused-note">
              この間に入るはずだったご予約は受けられません。空きが出たら早めに再開してください。
            </span>
            <button className="fb__paused-btn" onClick={() => switchPause(false)}>
              受付を再開する
            </button>
          </div>
        )}

        <p className="fb__pausesum">
          停止の記録：今日 {hhmm(pause.today_min)} ／ 今月 {hhmm(pause.month_min)}（
          {pause.month_count}回）
        </p>

        <div className="fb__body">
          <div className="fb__floor" ref={floorRef}>
            <div style={{ position: "relative", width: CANVAS_W * scale, height: CANVAS_H * scale }}>
              <div
                className="fb__canvas"
                style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})` }}
              >
                {/* 和室：座卓を挟んで奥に4席・手前に4席 */}
                <div
                  className={`fb__room${zashikiUsed > 0 ? " fb__room--on" : ""}`}
                  style={{ left: ZASHIKI.x, top: ZASHIKI.y, width: ZASHIKI.w, height: ZASHIKI.h }}
                >
                  <span className="fb__roomtop">
                    <b>和室</b>
                    <small>個室・8名掛け</small>
                    <em className="fb__state">
                      {zashikiUsed > 0 ? `使用中 ${zashikiUsed}/8席` : "空き"}
                    </em>
                  </span>
                </div>
                {Z_SEATS.map((s2) => seatBtn(s2, "room", `和室${s2.n}番`))}

                {/* L型カウンター：横バー＋右端から下へ折れる縦バー */}
                <div
                  className="fb__hbar"
                  style={{ left: HBAR.x, top: HBAR.y, width: HBAR.w, height: HBAR.h }}
                >
                  カウンター（残り{10 - counterUsed}席）
                </div>
                <div
                  className="fb__vbar"
                  style={{ left: VBAR.x, top: VBAR.y, width: VBAR.w, height: VBAR.h }}
                />
                {C_TOP.map((s2) => seatBtn(s2, "counter", `カウンター${s2.n}番`))}
                {C_SIDE.map((s2) => seatBtn(s2, "counter", `カウンター${s2.n}番`))}

                {/* テーブル3卓：天板を挟んで左右に3席ずつ */}
                {TABLES.map((t) => {
                  const used = tableUsed(t);
                  return (
                    // 位置は座標で決めるので、包む要素を挟むと基準がずれる。Fragment で並べる
                    <Fragment key={t.key}>
                      <div
                        className={`fb__tbl${used > 0 ? " fb__tbl--on" : ""}`}
                        style={{ left: t.x, top: t.y, width: t.w, height: t.h }}
                      >
                        <span className="fb__tbllabel">
                          <b>{t.key}</b>
                          <small>6名掛け</small>
                          <em className="fb__state">{used > 0 ? `${used}/6席` : "空き"}</em>
                        </span>
                      </div>
                      <div
                        className="fb__tbltop"
                        style={{ left: t.top.x, top: t.top.y, width: t.top.w, height: t.top.h }}
                      />
                      {t.seats.map((s2) => seatBtn(s2, "table", `${t.key} ${s2.n}番`))}
                    </Fragment>
                  );
                })}

                <p className="fb__hint" style={{ left: 292, top: 352, width: 400 }}>
                  座った席をタップ／お帰りはもう一度タップ（空いた席はネット予約に開放されます）
                </p>

                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo-face-192.png"
                  alt=""
                  className="fb__mark"
                  style={{ left: 72, top: 336, width: 120, height: 90 }}
                />
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
                  const done = r.status === "completed";
                  return (
                    <li
                      key={r.id}
                      className={`${kind ? `fb__li--${kind}` : ""}${done ? " fb__li--done" : ""}`}
                    >
                      <span className="fb__time">
                        {startLabel({ biz_date: date, starts_at: r.starts_at })}
                      </span>
                      <span className="fb__name">
                        {r.customer_name} 様 {r.party_size}名
                      </span>
                      <span className="fb__seatnote">{r.seat_note ?? ""}</span>
                      {done && <span className="fb__done">済</span>}
                      {r.source === "web_form" && <span className="fb__hp">HP</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        </div>

        {/* 停止は「押しにくく」する。何が起きるかを読ませてから確定させる */}
        {askPause && (
          <div className="fb__alert fb__alert--warn" role="alertdialog">
            <div className="fb__alert-card">
              <p className="fb__alert-title">本当に新規予約を止めますか？</p>
              <ul className="fb__warnlist">
                <li>
                  <b>本日の</b>ネット予約が<b>1件も入らなくなります</b>（明日以降の予約は今までどおり受け付けます）。
                </li>
                <li>お客様の画面では「×（満席）」と表示されます。</li>
                <li>
                  止めた時刻と再開した時刻が記録され、
                  <b>今月の停止時間として合計されます</b>。
                </li>
                <li>空きが出たら、必ず「受付を再開する」を押してください。</li>
              </ul>
              <p className="fb__warnnow">
                今月はここまで <b>{hhmm(pause.month_min)}</b>（{pause.month_count}回）止めています
              </p>
              <div className="fb__warnbtns">
                <button className="btn" onClick={() => setAskPause(false)}>
                  やめる
                </button>
                <button className="btn fb__warnok" onClick={() => switchPause(true)}>
                  停止する
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 点線の席を点けるとき：予約のお客様か、飛び込みかを一度だけきく */}
        {askSeat !== null && (
          <div className="fb__alert fb__alert--warn" role="alertdialog">
            <div className="fb__alert-card">
              <p className="fb__alert-title">
                {planned[askSeat]?.label ?? ""} 様（ご予約 {planned[askSeat]?.party ?? "?"}名）のお席です
              </p>
              <div className="fb__warnbtns">
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    const id = planned[askSeat]?.id;
                    setAskSeat(null);
                    save(askSeat, 1, id);
                  }}
                >
                  {planned[askSeat]?.label ?? "ご予約の"} 様 ご来店
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    const key = askSeat;
                    setAskSeat(null);
                    save(key, 1);
                  }}
                >
                  別のお客様（飛び込み）
                </button>
                <button className="btn" onClick={() => setAskSeat(null)}>
                  やめる
                </button>
              </div>
            </div>
          </div>
        )}

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

        {/*
          お客様からのLINEメッセージ（店主要望 2026-08-24）。
          店のLINEグループにも転送しているが、営業中は誰も見ない——
          レジ横のこの画面で、ネット予約と同じ音で気づけるようにする。
          返信はここからはできない（LINE公式アカウントのアプリから）。
        */}
        {lineAlerts.length > 0 && (
          <div className="fb__alert" role="alertdialog">
            <div className="fb__alert-card">
              <p className="fb__alert-title">お客様からLINEにメッセージ</p>
              {lineAlerts.map((m) => (
                <p key={m.id} className="fb__alert-line">
                  <b>{m.label} 様</b>「{m.text.length > 80 ? `${m.text.slice(0, 80)}…` : m.text}」
                </p>
              ))}
              <p className="fb__hint" style={{ position: "static", margin: "0.6rem 0 0" }}>
                ご返信は「LINE公式アカウント」アプリのチャットからお願いします。
              </p>
              <button className="btn btn-primary fb__alert-ok" onClick={() => setLineAlerts([])}>
                確認した
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
