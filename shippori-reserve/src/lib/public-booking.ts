import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  CLOSED_WEEKDAYS,
  DEFAULT_CLOSE_MIN,
  DEFAULT_EVENT_CAPACITY,
  DEFAULT_OPEN_MIN,
  DEFAULT_STAY_MIN,
  FRI_SAT_CLOSE_MIN,
} from "@/lib/constants";
import { computeSeatUsage, COUNTER_NAME, NO_SEAT } from "@/lib/seats";
import { planSeats, type PlanUnit } from "@/lib/seat-plan";
import { minutesToIso, nowJst, shiftDate, todayBizDate, weekdayOf } from "@/lib/time";
import type { BusinessMode, Reservation, SeatUnit } from "@/lib/types";

/**
 * ネット予約（HPの公開フォーム）の空席計算と登録。
 *
 * 空席の判定は店内アプリと完全に同じ物差し：
 *   - 通常営業は「1つの席は1晩1組」・カウンターは残席数
 *   - イベント営業は席を持たず定員（総受け入れ人数）
 * 最後の砦は DB 関数 net_reserve（advisory lock + 再判定 + 登録が1トランザクション）。
 *
 * ここはログイン不要の入り口なので、受け付ける範囲を明確に絞る：
 *   〜8名・当日は開始15分前まで・60日先まで。9名以上と直前はお電話へ誘導する。
 */
export const NET = {
  maxParty: 8,
  minLeadMin: 15, // 予約は開始の15分前まで受ける（店主指定・即時予約）
  cancelLeadMin: 120, // Webキャンセルは開始の2時間前まで
  maxDaysAhead: 60,
  slotStep: 15,
  firstStart: 1080, // 18:00
  lastStart: 1305, // 21:45（ネットで選べる最終入店時刻・店主指定。22時以降は電話のみ）
} as const;

export type NetDayStatus = "ok" | "few" | "full" | "closed" | "out";

type DayRow = {
  biz_date: string;
  mode: BusinessMode;
  is_busy: boolean;
  is_closed: boolean;
  event_name: string | null;
  event_capacity: number | null;
  flyer_url: string | null;
  open_min: number;
  close_min: number;
};

type ResvRow = Pick<
  Reservation,
  "id" | "biz_date" | "party_size" | "status" | "seat_note" | "is_exclusive" | "starts_at"
>;

/**
 * その日に貸切（25名様〜・フロア一体）が入っているか。
 *
 * 貸切は店を丸ごと押さえる予約なので、席が個別に埋まっていなくても
 * その日はもうネット予約を受けられない。
 * ここを見ていなかったため、貸切の日でも予約ページが「◯空席あり」を出し、
 * お客様が予約できてしまっていた（来店して初めて貸切だと分かる）。
 */
export const hasExclusive = (rows: ResvRow[]): boolean => rows.some((r) => r.is_exclusive);

const activeStatuses = ["tentative", "confirmed", "seated"] as const;

function deriveDay(date: string, settings: Record<string, unknown>): DayRow {
  const dow = weekdayOf(date);
  const closedWeekdays = Array.isArray(settings.closed_weekdays)
    ? (settings.closed_weekdays as number[])
    : CLOSED_WEEKDAYS;
  return {
    biz_date: date,
    mode: "normal",
    // 金土は既定で繁忙日（店主指定）。行があればその設定を尊重する
    is_busy: dow === 5 || dow === 6,
    is_closed: closedWeekdays.includes(dow),
    event_name: null,
    event_capacity: null,
    flyer_url: null,
    open_min: Number(settings.default_open_min) || DEFAULT_OPEN_MIN,
    close_min: dow === 5 || dow === 6 ? FRI_SAT_CLOSE_MIN : DEFAULT_CLOSE_MIN,
  };
}

/**
 * 席ボードのキー → 卓の名前（seat_units.name）。
 *
 * DB側の seat_slots テーブルと同じ対応を持つ（net_reserve は
 * `coalesce(seat_slots.unit_name, key)` で同じ結論を出す）。
 * ここがズレると「埋まっている卓を空きと誤認して予約を取ってしまう」ので、
 * 変更するときは必ず 0029_seat_log.sql と一緒に直すこと。
 */
export function unitOfSeatKey(key: string): string {
  const table = /^(T\d+)-\d+$/.exec(key);
  if (table) return table[1];
  if (/^Z\d+$/.test(key)) return "和室";
  if (/^C\d*$/.test(key)) return COUNTER_NAME;
  return key; // 旧キー（'T1' '和室'）はそれ自体が卓名
}

async function fetchRange(from: string, to: string) {
  const admin = createAdminClient();
  const [settingsQ, daysQ, resvQ, unitsQ, boardQ, pauseQ] = await Promise.all([
    admin.from("settings").select("key, value"),
    admin.from("business_days").select("*").gte("biz_date", from).lte("biz_date", to),
    admin
      .from("reservations")
      .select("id, biz_date, party_size, status, seat_note, is_exclusive, starts_at")
      .gte("biz_date", from)
      .lte("biz_date", to)
      .in("status", [...activeStatuses]),
    admin.from("seat_units").select("*").eq("is_active", true).order("sort_order"),
    admin.from("seat_board").select("biz_date, key, occupied").gte("biz_date", from).lte("biz_date", to),
    // 現場が受付を止めている日（席ボードの「新規予約停止」）
    admin
      .from("net_pause")
      .select("biz_date")
      .is("ended_at", null)
      .gte("biz_date", from)
      .lte("biz_date", to),
  ]);

  const settings = Object.fromEntries(
    (settingsQ.data ?? []).map((r) => [r.key as string, r.value]),
  ) as Record<string, unknown>;
  const days = new Map<string, DayRow>((daysQ.data ?? []).map((d) => [d.biz_date as string, d as DayRow]));
  const resv = new Map<string, ResvRow[]>();
  for (const r of (resvQ.data ?? []) as ResvRow[]) {
    const list = resv.get(r.biz_date) ?? [];
    list.push(r);
    resv.set(r.biz_date, list);
  }
  // 席ボード（タブレットの飛び込み記録）。日付ごとにまとめる。
  // 席は1席ずつ記録されるが、予約の空席判定は「1席でも埋まっていればその卓は満席」（店主指定）
  const board = new Map<string, BoardState>();
  // カウンターは「何席か」ではなく「どの席か」で持つ。
  // 飛び込みの記録と予約の下書きを合わせるとき、数だけだと重なりを見分けられず、
  // 別の席に座っている2組を1組ぶんに数えてしまう（＝空いているように見える）。
  const stools = new Map<string, Set<string>>();
  for (const b of (boardQ.data ?? []) as { biz_date: string; key: string; occupied: number }[]) {
    const cur = board.get(b.biz_date) ?? { taken: [], counterUsed: 0 };
    if (b.key === "C") cur.counterUsed = Math.max(cur.counterUsed, b.occupied);
    else if (/^C\d+$/.test(b.key)) {
      if (b.occupied > 0) {
        const set = stools.get(b.biz_date) ?? new Set<string>();
        set.add(b.key);
        stools.set(b.biz_date, set);
      }
    } else if (b.occupied > 0) {
      const unit = unitOfSeatKey(b.key);
      if (!cur.taken.includes(unit)) cur.taken.push(unit);
    }
    board.set(b.biz_date, cur);
  }

  /*
   * 予約から作った席の下書きも、埋まりとして数える。
   *
   * ★ここが二重予約の穴を塞いでいる。
   *   席メモが「指定なし」の予約は computeSeatUsage が読み飛ばすので、
   *   3名の指定なし予約が3組入っていても、ネット予約からは
   *   カウンターが10席まるごと空いて見えていた。当日、席が足りなくなる形。
   *   下書きで実際の席まで決めてしまえば、そのまま埋まりとして扱える。
   *
   * 席ボード（飛び込み）の記録と重ねるときは、席そのものの重なりで見る。
   */
  const planUnits = (unitsQ.data ?? []) as PlanUnit[];
  for (const [d, list] of resv) {
    const plan = planSeats(
      list.map((r) => ({
        id: r.id,
        party_size: r.party_size,
        seat_note: r.seat_note ?? "",
        is_exclusive: r.is_exclusive,
        starts_at: r.starts_at,
        label: "",
      })),
      planUnits,
      days.get(d)?.mode === "event" ? "event" : "normal",
    );
    const cur = board.get(d) ?? { taken: [], counterUsed: 0 };
    const set = stools.get(d) ?? new Set<string>();
    for (const key of plan.seats.keys()) {
      if (/^C\d+$/.test(key)) set.add(key);
      else {
        const unit = unitOfSeatKey(key);
        if (!cur.taken.includes(unit)) cur.taken.push(unit);
      }
    }
    stools.set(d, set);
    board.set(d, cur);
  }

  for (const [d, set] of stools) {
    const cur = board.get(d);
    if (cur) cur.counterUsed = Math.max(cur.counterUsed, set.size);
  }

  const paused = new Set<string>(
    ((pauseQ.data ?? []) as { biz_date: string }[]).map((p) => p.biz_date),
  );

  const stayRaw = Number(settings.default_stay_min);
  return {
    settings,
    days,
    resv,
    board,
    paused,
    units: (unitsQ.data ?? []) as SeatUnit[],
    stay: Number.isFinite(stayRaw) && stayRaw > 0 ? stayRaw : DEFAULT_STAY_MIN,
  };
}

/** 席ボード（飛び込み）の状態。予約と重複しうるのでカウンターは大きい方を採る */
export type BoardState = { taken: string[]; counterUsed: number };

export type NetSeatKey = "counter" | "table" | "private";

export type NetSeat = {
  key: NetSeatKey;
  /** お客様に見せる名前。個々の卓番（T1等）は見せない */
  label: string;
  /** 残り（カウンター=席数・テーブル=卓数・個室=室数） */
  remaining: number;
  /** この人数・この日で選べるか */
  selectable: boolean;
  /** 選べない理由（表示用）："埋" 予約済み／"狭" 人数が入らない／"繁" 繁忙日ルール */
  reason: "" | "埋" | "狭" | "繁";
};

/**
 * その晩の席を種類ごとにまとめて返す。お客様は「カウンター／テーブル席／個室掘りごたつ席」
 * から選び、どの卓（T1〜T3）になるかは登録時にこちらで割り当てる。
 * 店のルール：繁忙日の3名様以下はカウンターのみ（テーブル・個室は選択不可）。
 */
export function seatGroups(
  day: Pick<DayRow, "is_busy">,
  rows: ResvRow[],
  units: SeatUnit[],
  party: number,
  board?: BoardState,
): NetSeat[] {
  const usage = computeSeatUsage(rows as Reservation[]);
  // 席ボード（飛び込み）を重ねる。カウンターは予約と重複しうるので大きい方
  const taken = [...usage.taken, ...(board?.taken ?? [])];
  const counterUsed = Math.max(usage.counter_used, board?.counterUsed ?? 0);
  const busyRule = day.is_busy && party <= 3;
  // 貸切の日はお店ごと押さえてある。dayStatus が先に「満席」を返すので
  // ここまで来ないはずだが、席を出す口はここ1つなので念のため閉じておく。
  const blocked = usage.exclusive;
  const out: NetSeat[] = [];

  const counter = units.find((u) => u.is_shared);
  if (counter) {
    const remaining = Math.max(0, counter.capacity - counterUsed);
    out.push({
      key: "counter",
      label: `カウンター（残り${remaining}席）`,
      remaining,
      selectable: !blocked && remaining >= party,
      reason: !blocked && remaining >= party ? "" : "埋",
    });
  }

  const tables = units.filter((u) => !u.is_shared && u.area === "table");
  if (tables.length > 0) {
    const cap = Math.max(...tables.map((u) => u.capacity));
    const free = tables.filter((u) => !taken.includes(u.name)).length;
    const tooSmall = cap < party;
    out.push({
      key: "table",
      label: `テーブル席（${cap}名掛け・残り${free}卓）`,
      remaining: free,
      selectable: !blocked && free > 0 && !tooSmall && !busyRule,
      reason: blocked ? "埋" : busyRule ? "繁" : tooSmall ? "狭" : free > 0 ? "" : "埋",
    });
  }

  const priv = units.find((u) => !u.is_shared && u.area === "private");
  if (priv) {
    const privTaken = taken.includes(priv.name);
    const tooSmall = priv.capacity < party;
    out.push({
      key: "private",
      label: `個室掘りごたつ席（${priv.capacity}名掛け）`,
      remaining: privTaken ? 0 : 1,
      selectable: !blocked && !privTaken && !tooSmall && !busyRule,
      reason: blocked ? "埋" : busyRule ? "繁" : tooSmall ? "狭" : privTaken ? "埋" : "",
    });
  }

  return out;
}

/** 選ばれた種類 → 実際に確保する席（卓番）。空きから順に割り当てる */
export function pickUnitFor(
  key: NetSeatKey,
  rows: ResvRow[],
  units: SeatUnit[],
  board?: BoardState,
): string | null {
  const usage = computeSeatUsage(rows as Reservation[]);
  if (usage.exclusive) return null; // 貸切の日は割り当てる席が無い
  const taken = [...usage.taken, ...(board?.taken ?? [])];
  if (key === "counter") return units.find((u) => u.is_shared)?.name ?? null;
  if (key === "table") {
    const free = units
      .filter((u) => !u.is_shared && u.area === "table" && !taken.includes(u.name))
      .sort((a, b) => a.sort_order - b.sort_order);
    return free[0]?.name ?? null;
  }
  const priv = units.find((u) => !u.is_shared && u.area === "private");
  return priv && !taken.includes(priv.name) ? priv.name : null;
}

/** ネットで選べる入店時刻：18:00〜21:45 の15分刻み（店主指定・全営業日共通） */
export function slotMinutes(): number[] {
  const out: number[] = [];
  for (let m = NET.firstStart; m <= NET.lastStart; m += NET.slotStep) out.push(m);
  return out;
}

/** この枠は「今から15分後」より先か（当日の直前予約を締める） */
function slotLeadOk(date: string, min: number): boolean {
  const slotAt = new Date(minutesToIso(date, min)).getTime();
  return slotAt >= nowJst().getTime() + NET.minLeadMin * 60_000;
}

function dayCore(date: string, ctx: Awaited<ReturnType<typeof fetchRange>>) {
  const day = ctx.days.get(date) ?? deriveDay(date, ctx.settings);
  const rows = ctx.resv.get(date) ?? [];
  const board = ctx.board.get(date);
  return { day, rows, board };
}

function dayStatus(
  date: string,
  ctx: Awaited<ReturnType<typeof fetchRange>>,
  party: number,
): NetDayStatus {
  const today = todayBizDate();
  if (date < today || date > shiftDate(today, NET.maxDaysAhead)) return "out";

  const { day, rows } = dayCore(date, ctx);
  if (day.is_closed) return "closed";
  // 貸切の日は店ごと押さえられているので、席の空きにかかわらず受けられない
  if (hasExclusive(rows)) return "full";
  // 現場が受付を止めている日は、満席と同じく選べない
  if (ctx.paused.has(date)) return "full";
  // イベント営業のネット予約は前日まで（仕込みの都合・店主指定）
  if (day.mode === "event" && date <= today) return "full";

  // その日の枠が1つでも「15分前ルール」を満たすか（未来日は常に満たす）
  if (!slotMinutes().some((m) => slotLeadOk(date, m))) return "full";

  if (day.mode === "event") {
    const cap = day.event_capacity ?? DEFAULT_EVENT_CAPACITY;
    const guests = rows.reduce((a, r) => a + r.party_size, 0);
    if (guests + party > cap) return "full";
    return cap - guests - party < 8 ? "few" : "ok";
  }

  const { board } = dayCore(date, ctx);
  const selectable = seatGroups(day, rows, ctx.units, party, board).filter((s) => s.selectable);
  if (selectable.length === 0) return "full";
  return selectable.length === 1 ? "few" : "ok";
}

/** 予約ページのカレンダー用：月内の各日を ◯／残りわずか／×／休 で返す */
export async function monthAvailability(ym: string, party: number) {
  const today = todayBizDate();
  const first = `${ym}-01`;
  const last = shiftDate(`${ym}-01`, 40).slice(0, 8) + "01"; // 翌月1日
  const from = first < today ? today : first;
  const to = shiftDate(last, -1);
  const ctx = await fetchRange(from < to ? from : to, to);

  const out: { date: string; status: NetDayStatus }[] = [];
  for (let d = first; d < last; d = shiftDate(d, 1)) {
    out.push({
      date: d,
      status: d < from || d > to ? "out" : dayStatus(d, ctx, party),
    });
  }
  return out;
}

/** 予約ページの時間選択用：その日の枠一覧 */
export async function dayAvailability(date: string, party: number) {
  const ctx = await fetchRange(date, date);
  const { day, rows, board } = dayCore(date, ctx);
  const status = dayStatus(date, ctx, party);

  const slots = slotMinutes().map((m) => ({
    min: m,
    ok: status === "ok" || status === "few" ? slotLeadOk(date, m) : false,
  }));

  return {
    date,
    status,
    is_event: day.mode === "event",
    event_name: day.event_name,
    /** イベントのチラシ（お客様に内容と料金を見てもらう） */
    flyer_url: day.mode === "event" ? day.flyer_url : null,
    /** イベント当日：ネットは締切（お電話へ） */
    is_event_late: day.mode === "event" && date <= todayBizDate(),
    is_busy: day.is_busy,
    // 満席ではなく「現場が受付を止めている」ときは、その旨をお客様に伝える
    is_paused: ctx.paused.has(date),
    sms_required: smsEnabled(),
    slots,
    // イベント日は席の概念がない（お席自由）
    seats: day.mode === "event" ? [] : seatGroups(day, rows, ctx.units, party, board),
  };
}

/* ── SMS認証（Twilio Verify）────────────────────────────────
   3つの環境変数が揃っているときだけ有効。未設定なら従来どおり認証なしで通る。
   コードの発行・照合・有効期限・試行回数はすべてTwilio側が管理するので、
   こちらにコードを保存するテーブルは持たない。 */

export function smsEnabled(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_VERIFY_SID,
  );
}

/** 090… → +8190…（日本の携帯・固定をE.164へ） */
const toE164 = (digits: string): string => "+81" + digits.replace(/^0/, "");

async function twilioVerify(path: string, form: Record<string, string>) {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const service = process.env.TWILIO_VERIFY_SID!;
  const res = await fetch(`https://verify.twilio.com/v2/Services/${service}/${path}`, {
    method: "POST",
    headers: {
      authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await res.json().catch(() => null)) as
    | { status?: string; code?: number; message?: string }
    | null;
  if (!res.ok) {
    // ★本文（body.message）はログに出さない。
    //   Twilioの番号系エラーは本文に送信先の番号がそのまま入るので、
    //   出すとお客様の電話番号が Vercel のログという第二の保管場所へ流れる。
    //   原因調査に要るのはエラー番号だけ。詳細はTwilioコンソールに残っている。
    console.error("twilio_verify_error", res.status, body?.code);
  }
  return { httpOk: res.ok, status: body?.status ?? "", errorCode: body?.code };
}

/** 認証コードを送る。成功: {ok:true} */
export async function startSmsVerification(
  phoneRaw: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!smsEnabled()) return { ok: false, error: "SMS認証は現在準備中です。" };
  const digits = normalizePhone(phoneRaw);
  if (!digits) return { ok: false, error: "電話番号を正しく入力してください（10〜11桁）。" };
  const r = await twilioVerify("Verifications", {
    To: toE164(digits),
    Channel: "sms",
    Locale: "ja",
  });
  if (!r.httpOk) {
    // ★Twilioのエラー番号も本文も画面に出さない。
    //   番号を変えながら叩けば「その番号は実在するか・携帯か・ブロック中か」を
    //   外から判定できる照会窓口になってしまう。お客様向けの一文だけ返す。
    return {
      ok: false,
      error:
        "認証コードを送れませんでした。しばらく待ってからもう一度お試しいただくか、お電話（0897-47-4494）でご予約ください。",
    };
  }
  return { ok: true };
}

/** 入力されたコードを照合する */
async function checkSmsVerification(digits: string, code: string): Promise<boolean> {
  const r = await twilioVerify("VerificationCheck", { To: toE164(digits), Code: code });
  return r.httpOk && r.status === "approved";
}

export type NetBookingInput = {
  date: string;
  start_min: number;
  party: number;
  /** お客様が選んだ席（イベント日は不要） */
  seat?: string;
  /** フルネーム（姓と名） */
  name: string;
  kana?: string;
  phone: string;
  memo?: string;
  /** SMS認証コード（SMS認証が有効なとき必須） */
  sms_code?: string;
  /** ハニーポット。人間には見えない欄。埋まっていたらボット */
  website?: string;
};

export type NetBookingResult =
  | { ok: true; reference: string; seat_note: string; cancel_token?: string }
  | { ok: false; error: string; code?: "RETRY" | "REJECT" | "SMS" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizePhone(raw: string): string | null {
  let digits = (raw ?? "").replace(/[^0-9]/g, "");
  // 連絡先の自動入力は「+81 80-1996-8762」形式で来ることがある
  if ((raw ?? "").trim().startsWith("+81") && digits.startsWith("81")) {
    digits = "0" + digits.slice(2);
  }
  return digits.length >= 10 && digits.length <= 11 ? digits : null;
}

export async function createNetReservation(input: NetBookingInput): Promise<NetBookingResult> {
  if ((input.website ?? "") !== "") {
    // ボットには成功したふりをして時間を無駄にさせない
    return { ok: true, reference: "R-0000-0000", seat_note: NO_SEAT };
  }

  const name = (input.name ?? "").trim();
  const kana = (input.kana ?? "").trim();
  const memo = (input.memo ?? "").trim();
  const phone = normalizePhone(input.phone ?? "");
  const party = input.party;

  if (!DATE_RE.test(input.date ?? "")) return { ok: false, error: "日付が不正です。" };
  if (!Number.isInteger(party) || party < 1) return { ok: false, error: "人数を選んでください。" };
  if (party > NET.maxParty) {
    return { ok: false, error: "9名様以上のご予約はお電話で承ります。", code: "REJECT" };
  }
  if (!name) return { ok: false, error: "お名前を入力してください。" };
  if (!/\S+[\s　]+\S+/.test(name)) {
    return { ok: false, error: "お名前は姓と名（フルネーム）でご入力ください。" };
  }
  if (name.length > 40 || kana.length > 40) return { ok: false, error: "お名前が長すぎます。" };
  if (!phone) return { ok: false, error: "電話番号を正しく入力してください（10〜11桁）。" };
  if (memo.length > 200) return { ok: false, error: "ご要望は200文字以内でお願いします。" };
  if (!Number.isInteger(input.start_min)) return { ok: false, error: "時間を選んでください。" };

  const today = todayBizDate();
  if (input.date < today) return { ok: false, error: "過去の日付は選べません。" };
  if (input.date > shiftDate(today, NET.maxDaysAhead)) {
    return { ok: false, error: `ご予約は${NET.maxDaysAhead}日先まで承っています。` };
  }

  const admin = createAdminClient();

  // 同じ電話番号の乱発を抑える（今後の営業日に3件まで）
  const { data: samePhone } = await admin
    .from("reservations")
    .select("id")
    .eq("source", "web_form")
    .in("status", [...activeStatuses])
    .gte("biz_date", today)
    .eq("phone", phone)
    .limit(3);
  if ((samePhone ?? []).length >= 3) {
    return {
      ok: false,
      error: "同じ電話番号でのご予約が上限に達しています。変更はお電話でお願いします。",
      code: "REJECT",
    };
  }

  const ctx = await fetchRange(input.date, input.date);
  const { day, rows, board } = dayCore(input.date, ctx);

  if (day.is_closed) return { ok: false, error: "この日は定休日です。", code: "RETRY" };
  if (!slotMinutes().includes(input.start_min)) {
    return { ok: false, error: "時間を選び直してください。", code: "RETRY" };
  }
  if (!slotLeadOk(input.date, input.start_min)) {
    return {
      ok: false,
      error: "直前のご予約はネットでは承れません（開始15分前まで）。お電話ください。",
      code: "RETRY",
    };
  }

  let seatNote = NO_SEAT;
  if (day.mode === "event") {
    const cap = day.event_capacity ?? DEFAULT_EVENT_CAPACITY;
    const guests = rows.reduce((a, r) => a + r.party_size, 0);
    if (guests + party > cap) return { ok: false, error: "満席です。", code: "RETRY" };
  } else {
    const picked = seatGroups(day, rows, ctx.units, party, board).find(
      (s) => s.key === (input.seat ?? "").trim(),
    );
    if (!picked) return { ok: false, error: "お席を選んでください。", code: "RETRY" };
    if (!picked.selectable) {
      return {
        ok: false,
        error:
          picked.reason === "繁"
            ? "この日は3名様以下はカウンター席のみ承っています。"
            : "その席は選べなくなりました。空席を選び直してください。",
        code: "RETRY",
      };
    }
    const unit = pickUnitFor(picked.key, rows, ctx.units, board);
    if (!unit) {
      return { ok: false, error: "その席は選べなくなりました。空席を選び直してください。", code: "RETRY" };
    }
    seatNote = unit;
  }

  // 本人確認（SMS認証が有効なときだけ）。席・時間の検査を全部通ってから照合する
  if (smsEnabled()) {
    const code = (input.sms_code ?? "").trim();
    if (!/^\d{4,8}$/.test(code)) {
      return { ok: false, error: "SMSで届いた認証コードを入力してください。", code: "SMS" };
    }
    if (!(await checkSmsVerification(phone, code))) {
      return { ok: false, error: "認証コードが違うか、期限切れです。もう一度お試しください。", code: "SMS" };
    }
  }

  const { data, error } = await admin.rpc("net_reserve", {
    p_date: input.date,
    p_starts_at: minutesToIso(input.date, input.start_min),
    p_ends_at: minutesToIso(input.date, input.start_min + ctx.stay),
    p_party: party,
    p_name: name,
    p_kana: kana || null,
    p_phone: phone,
    p_memo: memo || null,
    p_seat_note: seatNote,
  });

  if (error) {
    if (/NET_EVENT_TODAY/.test(error.message)) {
      return {
        ok: false,
        error:
          "イベント営業日の当日のご予約は、お電話（0897-47-4494）にて承ります。",
        code: "RETRY",
      };
    }
    if (/NET_PAUSED/.test(error.message)) {
      return {
        ok: false,
        error:
          "ただいま混み合っているため、この日のネット受付を一時停止しております。お電話（0897-47-4494）でお問い合わせください。",
        code: "RETRY",
      };
    }
    // 押した瞬間に他の人が取ったケース。最新の空きで選び直してもらう
    // NET_EXCLUSIVE は貸切の日。理由は外に出さず、満席と同じ言い方にする
    // （「その日は貸切です」と返すと、店の予定を誰でも確かめられてしまう）
    if (/NET_FULL|NET_CLOSED|NET_EXCLUSIVE/.test(error.message)) {
      return {
        ok: false,
        error: "申し訳ありません、たった今この枠が埋まりました。別の日時をお選びください。",
        code: "RETRY",
      };
    }
    return { ok: false, error: "予約を確定できませんでした。お電話でお問い合わせください。" };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.reference) {
    return { ok: false, error: "予約を確定できませんでした。お電話でお問い合わせください。" };
  }
  const reference = row.reference as string;

  /*
   * キャンセル用の合言葉を取ってくる。
   *
   * 予約番号（R-2608-0038）は月ごとの連番なので、秘密にならない。
   * 0033 で推測できない合言葉を持たせたので、完了画面のキャンセル用リンクには
   * こちらを載せる。番号＋電話の入力も残す——リンクを閉じてしまった人が
   * 電話でしかキャンセルできなくなると、当日の無断キャンセルに化ける。
   *
   * 取れなくても予約自体は成立している。リンクが出ないだけなので、
   * ここで失敗にはしない。
   */
  let cancelToken: string | undefined;
  try {
    const { data: t } = await createAdminClient()
      .from("reservations")
      .select("cancel_token")
      .eq("reference", reference)
      .maybeSingle<{ cancel_token: string }>();
    cancelToken = t?.cancel_token ?? undefined;
  } catch {
    // リンクなしで続ける
  }

  return { ok: true, reference, seat_note: seatNote, cancel_token: cancelToken };
}

export type NetCancelResult = { ok: true } | { ok: false; error: string };

/**
 * 合言葉（cancel_token）だけでキャンセルする。
 *
 * 完了画面のリンクから来た人向け。推測できない値なので電話番号は要らない。
 * 番号を総当たりされる心配が無いぶん、こちらのほうが安全でもある。
 */
export async function cancelNetReservationByToken(tokenRaw: string): Promise<NetCancelResult> {
  const token = (tokenRaw ?? "").trim().toLowerCase();
  const notFound = {
    ok: false as const,
    error: "このリンクからはキャンセルできません。お電話（0897-47-4494）でご連絡ください。",
  };
  // UUID の形だけは見る（違う形をDBに投げると型エラーで落ちる）
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(token)) {
    return notFound;
  }

  const admin = createAdminClient();
  const { data: r } = await admin
    .from("reservations")
    .select("id, biz_date, starts_at, status, phone, source")
    .eq("cancel_token", token)
    .maybeSingle<Pick<Reservation, "id" | "biz_date" | "starts_at" | "status" | "phone" | "source">>();
  if (!r) return notFound;

  return finishCancel(admin, r);
}

export async function cancelNetReservation(
  referenceRaw: string,
  phoneRaw: string,
): Promise<NetCancelResult> {
  const reference = (referenceRaw ?? "").trim().toUpperCase().replace(/\s/g, "");
  const phone = normalizePhone(phoneRaw ?? "");

  /*
   * ★返す文言を1本に統一する。
   *
   * 以前は「見つかりません」「すでにキャンセル済み」「2時間前を過ぎた」を
   * 別々に返していた。予約番号は月ごとの連番なので、電話番号を1つ知っていれば
   * 0001 から順に投げるだけで、どの番号が当たりかを応答の違いから判別できた。
   * 当たった相手の予約を消せるだけでなく、消さなくても
   * 「この電話番号の人がこの店に予約している」という事実が第三者に分かってしまう。
   *
   * 状態の違いを見せてよいのは、番号と電話が一致したあとだけ。
   * 一致しない限り、どの経路でも同じ一文を返す。
   */
  const mismatch = {
    ok: false as const,
    error: "予約が見つかりません。番号と電話番号をご確認ください。",
  };
  if (!/^R-\d{4}-\d{4}$/.test(reference)) return mismatch;
  if (!phone) return mismatch;

  const admin = createAdminClient();
  const { data: r } = await admin
    .from("reservations")
    .select("id, biz_date, starts_at, status, phone, source")
    .eq("reference", reference)
    .maybeSingle<Pick<Reservation, "id" | "biz_date" | "starts_at" | "status" | "phone" | "source">>();

  if (!r || !r.phone || normalizePhone(r.phone) !== phone) return mismatch;

  return finishCancel(admin, r);
}

/**
 * 本人だと分かったあとの共通処理。
 * ここから先は状態の違いを伝えてよい（当たり外れを推測させる心配が無い）。
 *
 * 番号＋電話の経路と合言葉の経路で、締切や状態の扱いが食い違わないよう1か所にまとめる。
 */
async function finishCancel(
  admin: ReturnType<typeof createAdminClient>,
  r: Pick<Reservation, "id" | "biz_date" | "starts_at" | "status" | "phone" | "source">,
): Promise<NetCancelResult> {
  if (r.status === "cancelled") return { ok: false, error: "この予約はすでにキャンセル済みです。" };
  if (r.status !== "tentative" && r.status !== "confirmed") {
    return { ok: false, error: "この予約はWebからは変更できません。お電話でご連絡ください。" };
  }
  if (new Date(r.starts_at).getTime() < nowJst().getTime() + NET.cancelLeadMin * 60_000) {
    return { ok: false, error: "開始2時間前を過ぎたキャンセルはお電話でお願いします。" };
  }

  const { error } = await admin
    .from("reservations")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: "お客様によるWebキャンセル",
    })
    .eq("id", r.id)
    .in("status", ["tentative", "confirmed"]);

  if (error) return { ok: false, error: "キャンセルできませんでした。お電話でご連絡ください。" };
  return { ok: true };
}
