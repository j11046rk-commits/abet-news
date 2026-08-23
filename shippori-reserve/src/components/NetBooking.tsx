"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { minutesToLabel, WEEKDAY_JA } from "@/lib/time";
import { startLineLogin, useLiff } from "@/lib/use-liff";

/**
 * お客様向けネット予約（ログイン不要）。
 * 人数 → 日付 → 時間 → お席 → お客様情報 → 確認 → 完了 の1画面ウィザード。
 * 空席・席の選択可否はすべて /api/public/availability に聞く（判定はサーバーだけが持つ）。
 * 繁忙日の3名様以下はカウンターのみ（テーブル・和室は選択不可＝店のルール）。
 */

const DRAFT_KEY = "net-draft";
const TEL = "0897-47-4494";
const TEL_HREF = "tel:0897474494";
/** 公式LINE（お客様向け）の友だち追加URL。LINE公式アカウント管理画面の lin.ee リンク */
const FRIEND_URL = process.env.NEXT_PUBLIC_LINE_FRIEND_URL ?? "";

type DayCell = { date: string; status: "ok" | "few" | "full" | "closed" | "out" };
type Slot = { min: number; ok: boolean };
type Seat = {
  key: "counter" | "table" | "private";
  label: string;
  remaining: number;
  selectable: boolean;
  reason: "" | "埋" | "狭" | "繁";
};
type DayInfo = {
  status: string;
  is_event: boolean;
  event_name: string | null;
  is_busy: boolean;
  is_paused: boolean;
  flyer_url: string | null;
  is_event_late: boolean;
  sms_required: boolean;
  slots: Slot[];
  seats: Seat[];
};

const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return ymOf(d);
};
/** +81形式や記号入りも受け付けて0始まりの数字に直す */
const phoneDigits = (raw: string) => {
  let d = raw.replace(/[^0-9]/g, "");
  if (raw.trim().startsWith("+81") && d.startsWith("81")) d = "0" + d.slice(2);
  return d;
};

const jaDate = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  const w = WEEKDAY_JA[new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日(${w})`;
};

/**
 * GA4のイベントを送る。タグが入っていない環境（開発・計測オフ）では何もしない。
 * 個人情報は渡さない——渡さないことをここ1か所で守れるように、経路を1本にしてある。
 */
function track(event: string, params: Record<string, string | number>): void {
  const g = (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag;
  if (typeof g === "function") g("event", event, params);
}

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
  const [seat, setSeat] = useState<Seat | null>(null);

  const [sei, setSei] = useState("");
  const [mei, setMei] = useState("");
  const [kana, setKana] = useState("");
  const [phone, setPhone] = useState("");
  const [memo, setMemo] = useState("");
  const [website, setWebsite] = useState(""); // ハニーポット（見えない欄）

  const [step, setStep] = useState<"pick" | "confirm" | "done">("pick");

  /*
   * 「LINEで予約する」はLINEの認証画面へ**ページごと移動**する。戻ってきたとき
   * Reactの状態は全部消えているので、押す直前に入力内容を端末に置いておき、
   * 戻ってきた直後に復元して確認画面まで連れて戻す。これが無いと、日付も人数も
   * 名前も入れ直し——「かんたんです」と勧めた導線が、いちばん手間のかかる道になる
   * （店主指摘 2026-08-20・ドッグフーディングで発覚）。
   *
   * sessionStorage を使う（localStorage にしない）。タブを閉じれば消えるので、
   * 名前と電話番号が端末に残り続けない。
   */
  const saveDraft = () => {
    try {
      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ at: Date.now(), party, ym, date, min, seat, sei, mei, kana, phone, memo }),
      );
    } catch {
      // プライベートモード等で書けなくても、予約そのものは続けられる
    }
  };
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      sessionStorage.removeItem(DRAFT_KEY); // 一度きり。古い下書きを何度も蘇らせない
      const d = JSON.parse(raw) as Record<string, unknown>;
      if (Date.now() - Number(d.at ?? 0) > 30 * 60_000) return; // 30分たった下書きは捨てる
      if (typeof d.party === "number") setParty(d.party);
      if (typeof d.ym === "string") setYm(d.ym);
      if (typeof d.date === "string") setDate(d.date);
      if (typeof d.min === "number") setMin(d.min);
      if (d.seat && typeof (d.seat as Seat).key === "string") setSeat(d.seat as Seat);
      if (typeof d.sei === "string") setSei(d.sei);
      if (typeof d.mei === "string") setMei(d.mei);
      if (typeof d.kana === "string") setKana(d.kana);
      if (typeof d.phone === "string") setPhone(d.phone);
      if (typeof d.memo === "string") setMemo(d.memo);
      /*
       * 復元しただけでは、その日の空き情報（dayInfo）が無い。取り直さないと、
       * LINEの認証が切れていたときに「SMSが要る日か」が分からず、
       * SMSの入力欄を出せないまま確認画面で行き止まりになる。
       */
      if (typeof d.date === "string") {
        loadDay(d.date, typeof d.party === "number" ? d.party : 2);
      }
      // 全部そろった下書きなら確認画面まで戻す。残る操作は「予約する」を押すだけ
      if (
        typeof d.date === "string" &&
        typeof d.min === "number" &&
        typeof d.sei === "string" && d.sei !== "" &&
        typeof d.mei === "string" && d.mei !== "" &&
        typeof d.phone === "string" && d.phone !== ""
      ) {
        setStep("confirm");
      }
    } catch {
      // 壊れた下書きは無視して、ふつうに最初から
    }
    // 復元は開いた瞬間の一度だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [doneRef, setDoneRef] = useState("");
  const [doneSeat, setDoneSeat] = useState("");
  const [doneToken, setDoneToken] = useState("");
  /** LINEで確認できた予約か。完了画面の案内が変わる（控え・キャンセルともトークで済む） */
  const [doneViaLine, setDoneViaLine] = useState(false);
  /** 完了時点で友だちだったか。false なら控えは届いていない（友だちでない人には送れない） */
  const [doneFriend, setDoneFriend] = useState<boolean | null>(null);
  /** サーバーが控えのLINE送信に**実際に成功したか**。これが true のときだけ「お送りしました」と言う */
  const [doneLineSent, setDoneLineSent] = useState(false);

  // SMS認証（サーバー側が有効なときだけ使う）
  const liff = useLiff(process.env.NEXT_PUBLIC_LIFF_ID);
  /*
   * LINEの確認が通らなかったとき（身分証の期限切れ・LINE障害）にSMSへ切り替える。
   * これが無いと、サーバーはSMSを求めているのに画面は入力欄を隠したままで、
   * お客様がどこにも進めなくなる。
   */
  const [forceSms, setForceSms] = useState(false);

  /*
   * LINEのお名前を、お名前欄の下書きに入れる。
   *
   * ★入れるのは「姓と名の間に空白がある」ときだけ。
   *   LINEの表示名はニックネームのことも多く（「たろう」「T.K」等）、
   *   それを姓に入れてしまうと、当日お呼びする名前が違ってしまう。
   *   空白で分かれている人＝本名を入れている人だけ、下書きにする。
   *   もちろんお客様がその場で直せる。
   */
  useEffect(() => {
    if (!liff.displayName || sei !== "" || mei !== "") return;
    const parts = liff.displayName.trim().split(/[\s　]+/);
    if (parts.length >= 2) {
      setSei(parts[0]);
      setMei(parts.slice(1).join(" "));
    }
    // 下書きは1度だけ。お客様が消したのに書き戻さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liff.displayName]);
  const [smsSent, setSmsSent] = useState(false);
  const [smsSending, setSmsSending] = useState(false);
  const [smsCode, setSmsCode] = useState("");
  // イベント日は「通常営業と違う」ことへの同意を取ってから先へ進める
  const [eventAgreed, setEventAgreed] = useState(false);
  // チラシが読み込めなかったとき、壊れた画像を出さずに文字のリンクだけ残す
  const [flyerBroken, setFlyerBroken] = useState(false);

  const timeRef = useRef<HTMLDivElement>(null);
  const seatRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // iOSの予測変換・自動入力は入力イベントを起こさないことがあるので、
  // 表示中は入力欄の実際の値を定期的に拾い直す（黄色く塗られても値は取れる）
  const seiRef = useRef<HTMLInputElement>(null);
  const meiRef = useRef<HTMLInputElement>(null);
  const kanaRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const smsRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setInterval(() => {
      const sync = (
        ref: React.RefObject<HTMLInputElement | null>,
        cur: string,
        set: (v: string) => void,
      ) => {
        const v = ref.current?.value;
        if (v !== undefined && v !== cur) set(v);
      };
      sync(seiRef, sei, setSei);
      sync(meiRef, mei, setMei);
      sync(kanaRef, kana, setKana);
      sync(phoneRef, phone, setPhone);
      sync(smsRef, smsCode, (v) => setSmsCode(v.replace(/[^0-9]/g, "")));
    }, 400);
    return () => clearInterval(t);
  }, [sei, mei, kana, phone, smsCode]);

  // 読み込みの失敗は無言にしない。空のカレンダーだけ出すと「全部満席」に見える
  const [monthError, setMonthError] = useState(false);
  const [dayError, setDayError] = useState(false);

  const loadMonth = useCallback(async (targetYm: string, targetParty: number) => {
    setMonthLoading(true);
    setMonthError(false);
    try {
      const res = await fetch(`/api/public/availability?ym=${targetYm}&party=${targetParty}`);
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.days)) throw new Error("bad-response");
      setDays(data.days);
    } catch {
      setDays([]);
      setMonthError(true);
    }
    setMonthLoading(false);
  }, []);

  const loadDay = useCallback(async (targetDate: string, targetParty: number) => {
    setDayInfo(null);
    setDayError(false);
    try {
      const res = await fetch(`/api/public/availability?date=${targetDate}&party=${targetParty}`);
      const data = await res.json();
      // エラー応答をそのまま入れると slots が無く、時間の一覧の描画ごと落ちる
      if (!res.ok || !Array.isArray(data.slots)) throw new Error("bad-response");
      setDayInfo(data);
    } catch {
      setDayInfo(null);
      setDayError(true);
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
    setSeat(null);
  };

  const pickDate = (d: DayCell) => {
    if (d.status !== "ok" && d.status !== "few") return;
    setDate(d.date);
    setMin(null);
    setSeat(null);
    loadDay(d.date, party);
    setTimeout(() => timeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  const pickMin = (m: number) => {
    setMin(m);
    setTimeout(() => seatRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  const pickSeat = (s: Seat) => {
    setSeat(s);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  const isEvent = dayInfo?.is_event === true;
  /*
   * LINEで開かれていれば、そちらを本人確認に使う。
   *
   * SMSと両方やらせない——LINEのアカウントは電話番号がないと作れないので、
   * 本人確認としては同じ役目を果たす。同じことを2回証明させる意味がない。
   * LINEが使えない・確かめられないときは、これまでどおりSMSの道を通る。
   */
  const smsRequired = dayInfo?.sms_required === true && (!liff.ready || forceSms);
  const seatDone = isEvent || seat !== null;
  const canConfirm =
    date !== null &&
    min !== null &&
    seatDone &&
    sei.trim() !== "" &&
    mei.trim() !== "" &&
    // 10〜11桁だけ通す。上限が無いと、12桁でも確認画面に進めてサーバーで弾かれる
    phoneDigits(phone).length >= 10 &&
    phoneDigits(phone).length <= 11;

  const fullName = `${sei.trim()} ${mei.trim()}`.trim();

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
          seat: isEvent ? undefined : (seat?.key ?? ""),
          name: fullName,
          kana,
          phone,
          memo,
          sms_code: smsCode,
          line_id_token: liff.idToken ?? undefined,
          website,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setDoneRef(data.reference as string);
        setDoneSeat(isEvent ? "" : (seat?.label ?? ""));
        setDoneToken(typeof data.cancel_token === "string" ? data.cancel_token : "");
        // 「LINEの予約として通ったか」はサーバーの返事で決める。画面側の liff.ready は
        // 認証が期限切れでもtrueのままなので、これを信じると嘘の完了画面になる
        setDoneViaLine(data.via_line === true);
        setDoneFriend(liff.friend);
        setDoneLineSent(data.line_notified === true);
        /*
         * 予約が確定した回数を数える（GA4）。転換率を出すのに必要な片方。
         * 見た人数はページの計測で分かるが、確定した数はここでしか分からない。
         *
         * 送るのは人数と席の種別だけ。氏名・電話番号・予約番号・合言葉は送らない。
         * 日付も送らない——「いつ来るか」は店の中の情報で、外に出す理由が無い。
         */
        track("reserve_complete", {
          party,
          seat_kind: isEvent ? "event" : (seat?.key ?? "unknown"),
        });
        setStep("done");
      } else if (data.code === "SMS") {
        // コード違いは確認画面のままやり直せる。
        // LINEの確認が切れていた場合も、ここでSMSの欄を出し直す
        setForceSms(true);
        setError(data.error ?? "認証コードをご確認ください。");
      } else {
        setError(data.error ?? "予約できませんでした。");
        setStep("pick");
        if (data.code === "RETRY") {
          // たった今埋まった等。最新の空きを取り直して選び直してもらう
          setSeat(null);
          loadMonth(ym, party);
          if (date) loadDay(date, party);
        }
      }
    } catch {
      setError("通信に失敗しました。電波の良い場所でもう一度お試しください。");
      setStep("pick");
    }
    setSending(false);
  };

  const sendSms = async () => {
    if (smsSending) return;
    setSmsSending(true);
    setError("");
    try {
      const res = await fetch("/api/public/sms-start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (data.ok) setSmsSent(true);
      else setError(data.error ?? "認証コードを送れませんでした。");
    } catch {
      setError("通信に失敗しました。もう一度お試しください。");
    }
    setSmsSending(false);
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
          {doneSeat && <div><dt>お席</dt><dd>{doneSeat}</dd></div>}
          <div><dt>お名前</dt><dd>{fullName} 様</dd></div>
        </dl>
        {/*
          LINEで予約された方の案内は、公式LINEに寄せる（店主指示 2026-08-20）。
          控えはもうトークに届いていて、変更・キャンセルもトークに書けば済む。
          「スクショを控えて・リンクを保存して」は、LINEの人には全部余計な手間。
          電話番号で予約された方には、これまでどおりリンクの控えを案内する
          （その方たちにはトークという道が無いので）。
        */}
        {doneViaLine && !doneLineSent ? (
          /*
            LINEで予約したが、控えが**届いていない**人。
            友だちでない（LINEは友だちでない相手に送信できない）か、送信自体が
            失敗したかのどちらか。いずれにせよ「お送りしました」とは言わない——
            届いていないものを届いたと言うのが、いちばん信用を落とす。
            友だちでない人には追加の入口を出す（追加すれば前日のご案内から届き、
            トークでの変更・キャンセルもできる）。
            それまでのキャンセル手段として、リンクの控えも従来どおり出す。
          */
          <div className="net__note">
            {FRIEND_URL && doneFriend === false ? (
              <a className="net__friend" href={FRIEND_URL} target="_blank" rel="noopener noreferrer">
                <span className="net__friend-badge">LINE</span>
                <span>
                  <b>公式LINEを友だち追加してください</b>
                  <br />
                  前日のご案内が届き、変更・キャンセルもトークでできます ›
                </span>
              </a>
            ) : null}
            {doneFriend !== false && (
              // 友だちなのに送信が失敗した（LINE側の不調など）。理由まで見せる必要は
              // 無いが、「届いていない」ことだけは伝える
              <p>
                <b>LINEへの控えの送信ができませんでした。</b>
              </p>
            )}
            <p style={{ marginTop: "0.8rem" }}>
              <b>この画面をお控えください</b>（スクリーンショット推奨）。
            </p>
            {doneToken ? (
              <p>
                キャンセルは{" "}
                <a href={`/yoyaku/cancel?t=${encodeURIComponent(doneToken)}`}>
                  <b>このリンク</b>
                </a>{" "}
                から（開始2時間前まで）。
              </p>
            ) : null}
            <p>お電話（<a href={TEL_HREF}>{TEL}</a>）でも承ります。</p>
          </div>
        ) : doneViaLine ? (
          <div className="net__note">
            <p>
              <b>ご予約の控えを公式LINEにお送りしました。</b>
            </p>
            <p>
              ご変更・キャンセルは、<b>公式LINEのトーク</b>にそのままご連絡ください。
            </p>
            <p>お急ぎの場合はお電話（<a href={TEL_HREF}>{TEL}</a>）でも承ります。</p>
          </div>
        ) : (
          <div className="net__note">
            <p><b>この画面をお控えください</b>（スクリーンショット推奨）。</p>
            {/*
              キャンセル用のリンクには合言葉（cancel_token）を載せる。
              予約番号は月ごとの連番で秘密にならないので、番号だけでは鍵にできない。
              リンクを控えておけば、電話番号を打ち直さずにキャンセルできる。
              控え忘れた人のために、番号＋電話番号の入り口も残してある。
            */}
            {doneToken ? (
              <p>
                キャンセルは{" "}
                <a href={`/yoyaku/cancel?t=${encodeURIComponent(doneToken)}`}>
                  <b>このリンク</b>
                </a>{" "}
                から（開始2時間前まで・リンクも一緒にお控えください）。
              </p>
            ) : (
              <p>
                キャンセルは <a href="/yoyaku/cancel">こちらのページ</a>（開始2時間前まで）から、
                予約番号と電話番号をご入力ください。
              </p>
            )}
            <p>お電話（<a href={TEL_HREF}>{TEL}</a>）でも承ります。</p>
          </div>
        )}
        {/*
          友だち追加の導線（店主要望 2026-08-19）。
          電話番号で予約した人＝LINEと結びつかなかった人にだけ出す。
          LINEで予約した人はもう友だちなので、勧めても意味が無いどころか
          「分かっていない店」に見える。完了画面は必ず読まれる場所なので、
          月30件の予約がそのまま友だち化の入口になる。
          追加用URL（lin.ee）が未設定なら何も出さない。
        */}
        {!liff.ready && FRIEND_URL ? (
          <a className="net__friend" href={FRIEND_URL} target="_blank" rel="noopener noreferrer">
            <span className="net__friend-badge">LINE</span>
            <span>
              <b>友だち追加で、生ビール1杯無料！</b>
              <br />
              次回から予約もかんたんに。タップして追加 ›
            </span>
          </a>
        ) : null}
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
          <div><dt>お席</dt><dd>{isEvent ? "自由席（イベント営業）" : seat?.label}</dd></div>
          <div><dt>お名前</dt><dd>{fullName}{kana.trim() ? `（${kana.trim()}）` : ""} 様</dd></div>
          <div><dt>電話番号</dt><dd>{phone}</dd></div>
          {memo.trim() && <div><dt>ご要望</dt><dd>{memo.trim()}</dd></div>}
        </dl>
        <p className="net__fineprint">
          キャンセルは開始2時間前までWebで、それ以降はお電話でお願いします。
        </p>
        {isEvent && (
          <div className="net__agree">
            {dayInfo?.flyer_url && (
              <p className="net__agree-link">
                <a href={dayInfo.flyer_url} target="_blank" rel="noreferrer">
                  イベントのチラシをもう一度見る
                </a>
              </p>
            )}
            <label className="net__agree-box">
              <input
                type="checkbox"
                checked={eventAgreed}
                onChange={(e) => setEventAgreed(e.target.checked)}
              />
              <span>
                ご予約の日はイベント営業であり、通常営業とメニューや価格設定が違うことを確認し、
                了承しました。
              </span>
            </label>
          </div>
        )}
        {/*
          LINEで開かれているときは、SMSの代わりにこちらを出す。
          外のブラウザで開いた方には「LINEで予約」への入口を出すが、
          電話番号での予約も**そのまま残す**——LINEを使っていない方を締め出さない。
        */}
        {liff.settled && liff.ready && (!isEvent || eventAgreed) ? (
          <div className="net__line">
            <p className="net__line-title">LINEでご予約中</p>
            <p className="net__hint">
              {liff.displayName ? `${liff.displayName} 様として承ります。` : "LINEのアカウントで確認済みです。"}
              <br />
              ご予約の控えをLINEにお送りします。ご変更・キャンセルもトークから承ります。
            </p>
          </div>
        ) : null}
        {liff.settled && liff.available && !liff.ready && !liff.inClient && process.env.NEXT_PUBLIC_LIFF_ID && (!isEvent || eventAgreed) ? (
          <div className="net__line">
            <p className="net__line-title">LINEで予約すると、かんたんです</p>
            <p className="net__hint">
              SMSの認証が要りません。ご予約の控えが届き、ご変更・キャンセルもトークから承れます。
            </p>
            <button
              type="button"
              className="btn net__line-btn"
              onClick={() => {
                // 認証から戻ったら入力を復元するため、移動の直前に控えを置く
                saveDraft();
                startLineLogin();
              }}
            >
              LINEで予約する
            </button>
          </div>
        ) : null}
        {smsRequired && (!isEvent || eventAgreed) && (
          <div className="net__sms">
            <p className="net__sms-title">携帯電話番号の確認</p>
            {smsSent ? (
              <>
                <p className="net__hint">{phone} 宛にSMSで認証コードを送りました。届いた数字を入力してください。</p>
                <input
                  ref={smsRef}
                  className="field net__sms-code"
                  value={smsCode}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  placeholder="認証コード"
                  onChange={(e) => setSmsCode(e.target.value.replace(/[^0-9]/g, ""))}
                />
                <button className="btn net__sms-resend" onClick={sendSms} disabled={smsSending}>
                  {smsSending ? "送信中…" : "コードを再送する"}
                </button>
              </>
            ) : (
              <>
                <p className="net__hint">イタズラ予約防止のため、携帯電話番号の確認にご協力ください。</p>
                <button className="btn btn-primary net__sms-send" onClick={sendSms} disabled={smsSending}>
                  {smsSending ? "送信中…" : `${phone} に認証コードを送る`}
                </button>
              </>
            )}
          </div>
        )}
        {error && <p className="net__error">{error}</p>}

        {/*
          お預かりする情報の説明。個人情報保護法21条1項（利用目的の通知）と
          28条（外国にある第三者への提供＝Twilio）にあたる。
          置き場所は送信ボタンのすぐ上——電話番号を渡す前に読める位置でないと、
          書いてあっても知らせたことにならない。
        */}
        <section className="net__privacy">
          <p className="net__privacy-title">お預かりする情報について</p>
          <p>
            お名前・電話番号は、ご予約の確認とご連絡（変更・確認のお電話、認証SMS）にのみ使います。
            ほかの目的には使わず、法令に基づく場合を除いて第三者には渡しません。
          </p>
          <p>
            ご来店日から<strong>13か月</strong>を過ぎたら、お名前と電話番号は自動的に消去します。
          </p>
          <p>
            認証SMSの送信には Twilio（米国）のサービスを利用しており、電話番号がそちらに送られます。
          </p>
          <p>
            このページの利用状況の把握に Google アナリティクスを使用しています
            （どのページが何回見られたかの集計で、お名前・電話番号は送っていません）。
          </p>
          <p>
            ご確認・削除のご依頼は <a href="tel:0897474494">0897-47-4494</a> へお申し付けください。
          </p>
        </section>

        <div className="net__btnrow">
          <button className="btn" onClick={() => setStep("pick")} disabled={sending}>戻る</button>
          <button
            className="btn btn-primary net__grow"
            onClick={submit}
            disabled={
              sending || (isEvent && !eventAgreed) || (smsRequired && smsCode.length < 4)
            }
          >
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
        {monthError && !monthLoading && (
          <p className="net__error">
            空席情報を読み込めませんでした。電波の良い場所で{" "}
            <button className="btn" onClick={() => loadMonth(ym, party)}>もう一度読み込む</button>
          </p>
        )}
        <p className="net__hint">◯ 空席あり ／ △ 残りわずか ／ × 満席 ／ 休 定休日（火曜）。当日は開始15分前まで承ります。</p>
      </section>

      <section className="net__card" ref={timeRef}>
        <h2 className="net__step-title"><span className="net__no">3</span>時間{date && <span className="net__picked">{jaDate(date)}</span>}</h2>
        {date === null ? (
          <p className="net__hint">先に日付をお選びください。</p>
        ) : dayError ? (
          <p className="net__error">
            空き時間を読み込めませんでした。{" "}
            <button className="btn" onClick={() => loadDay(date, party)}>もう一度読み込む</button>
          </p>
        ) : dayInfo === null ? (
          <p className="net__hint">空き時間を確認しています…</p>
        ) : dayInfo.is_event_late ? (
          <p className="net__busy">
            この日は「{dayInfo.event_name ?? "イベント営業"}」です。
            イベント当日のネットでのご予約は締め切りました。
            お電話（<a href={TEL_HREF}>{TEL}</a>）にて承ります。
          </p>
        ) : dayInfo.is_paused ? (
          <p className="net__busy">
            申し訳ございません。ただいま大変混み合っているため、この日のネットでの受付を一時停止しております。
            お電話（<a href={TEL_HREF}>{TEL}</a>）にてお問い合わせください。
          </p>
        ) : (
          <>
            {dayInfo.is_event && (
              <div className="net__event">
                <p>
                  この日は<b>通常営業と異なるイベント営業</b>「
                  {dayInfo.event_name ?? "イベント営業"}」になります（18:00〜24:00・お席は自由です）。
                  <b>メニューや価格設定が通常営業と異なります。</b>
                </p>
                {dayInfo.flyer_url && (
                  <p className="net__flyerlink">
                    詳細は
                    <a href={dayInfo.flyer_url} target="_blank" rel="noreferrer">
                      こちら（チラシ）
                    </a>
                    をご覧ください。
                  </p>
                )}
                {dayInfo.flyer_url && !flyerBroken && !/\.pdf(\?|$)/i.test(dayInfo.flyer_url) && (
                  <a href={dayInfo.flyer_url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="net__flyer"
                      src={dayInfo.flyer_url}
                      alt="イベントのチラシ"
                      onError={() => setFlyerBroken(true)}
                    />
                  </a>
                )}
              </div>
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
            <p className="net__hint">22時以降のご予約はお電話（<a href={TEL_HREF}>{TEL}</a>）にて承ります。</p>
          </>
        )}
      </section>

      <section className="net__card" ref={seatRef}>
        <h2 className="net__step-title"><span className="net__no">4</span>お席</h2>
        {date === null || dayInfo === null ? (
          <p className="net__hint">先に日付と時間をお選びください。</p>
        ) : isEvent ? (
          <p className="net__hint">イベント営業のため自由席です（お席の選択はありません）。</p>
        ) : (
          <>
            {dayInfo.is_busy && party <= 3 && (
              <p className="net__busy">この日は混み合う日のため、3名様以下のご予約はカウンターのみ受け付けております。当日の状況によってはテーブル席のご案内ができる場合もございますので、ご希望がございましたら、ご来店時にスタッフまでお気軽にお声がけください。</p>
            )}
            <div className="net__seats">
              {dayInfo.seats.map((s) => (
                <button
                  key={s.key}
                  className={`net__seat${seat?.key === s.key ? " net__seat--on" : ""}`}
                  disabled={!s.selectable}
                  onClick={() => pickSeat(s)}
                >
                  <span className="net__seat-name">{s.label}</span>
                  {!s.selectable && (
                    <span className="net__seat-why">
                      {s.reason === "埋" ? "満席" : s.reason === "繁" ? "この日は選べません" : "人数が入りません"}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="net__card" ref={formRef}>
        <h2 className="net__step-title"><span className="net__no">5</span>お客様情報</h2>
        <div className="net__namerow">
          <div>
            <label className="net__label" htmlFor="net-sei">姓 <em>必須</em></label>
            <input id="net-sei" ref={seiRef} className="field" value={sei} maxLength={20}
              onChange={(e) => setSei(e.target.value)} placeholder="例）山内" autoComplete="family-name" />
          </div>
          <div>
            <label className="net__label" htmlFor="net-mei">名 <em>必須</em></label>
            <input id="net-mei" ref={meiRef} className="field" value={mei} maxLength={20}
              onChange={(e) => setMei(e.target.value)} placeholder="例）太郎" autoComplete="given-name" />
          </div>
        </div>
        <label className="net__label" htmlFor="net-kana">フリガナ</label>
        <input id="net-kana" ref={kanaRef} className="field" value={kana} maxLength={40}
          onChange={(e) => setKana(e.target.value)} placeholder="例）ヤマウチ タロウ" />
        <label className="net__label" htmlFor="net-phone">電話番号 <em>必須</em></label>
        <input id="net-phone" ref={phoneRef} className="field" value={phone} type="tel" inputMode="tel"
          maxLength={20} onChange={(e) => setPhone(e.target.value)}
          placeholder="例）090-1234-5678" autoComplete="tel" />
        <label className="net__label" htmlFor="net-memo">ご要望（任意）</label>
        <textarea id="net-memo" className="field" value={memo} maxLength={200} rows={3}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="アレルギー・お祝い など" />
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
          onClick={() => { setError(""); setSmsSent(false); setSmsCode(""); setEventAgreed(false); setStep("confirm"); }}
        >
          予約内容を確認する
        </button>
        {!canConfirm && (
          <p className="net__hint">日付・時間・お席を選び、お名前（フルネーム）と電話番号をご入力ください。</p>
        )}
      </section>

      <p className="net__foot">
        ご予約の確認・キャンセルは <a href="/yoyaku/cancel">こちら</a>。
        お急ぎの場合は お電話（<a href={TEL_HREF}>{TEL}</a>）へどうぞ。
      </p>
    </div>
  );
}
