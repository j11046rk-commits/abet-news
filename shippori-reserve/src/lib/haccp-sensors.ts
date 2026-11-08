/*
 * 温度計（SwitchBot）の値から「知らせるか」「その日の記録に何を書くか」を決める。純粋な関数だけ（node --test で回す）。
 *
 * 決めごと（店主指定 2026-11-04／11-08）
 *  ・扉の開け閉めや霜取りで一瞬だけ上がるのは普通。知らせるのは「基準を外れた値が2回続いた（約30分以上）」とき
 *  ・同じ知らせは間を空ける（基準外 3時間・データ止まり 12時間・電池 3日）。基準内に戻ったら「戻りました」を1回
 *  ・値が何時間もまったく同じ（温度も湿度も）＝ハブが止まって古い値が返っている可能性。止まりとして知らせる
 *  ・毎晩の記録は「その営業日の最後の値」。その日に基準外が続いた時間があれば、最後が基準内でも「問題あり」にして、
 *    いつ・何℃まで上がったかを書く（記録をきれいに見せるために事実を落とさない）
 */

export type Reading = { temp_c: number; humidity: number | null; battery: number | null; read_at: string };
export type Limits = { maxC: number | null; minC: number | null };
export type AlertKind = "out_of_range" | "stale" | "battery" | "error";

const nn = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

export function isOut(l: Limits, t: number): boolean {
  return (nn(l.maxC) && t > l.maxC) || (nn(l.minC) && t < l.minC);
}

/** 知らせの間隔（ミリ秒） */
export const ALERT_GAP_MS: Record<AlertKind, number> = {
  out_of_range: 3 * 3600_000,
  stale: 12 * 3600_000,
  battery: 72 * 3600_000,
  error: 6 * 3600_000,
};

/** 同じ値がこの回数続いたら「止まっているかも」（30分ごとなら3時間） */
export const STALE_COUNT = 6;
/** 電池がこの%以下で知らせる（SwitchBot は 10/20/60/100 の4段階で返す） */
export const BATTERY_LOW = 20;

/**
 * 新しい順の読み取り値から、いま出すべき知らせを決める。
 * sentAt: 種類ごとに最後に送った時刻（無ければ未送信）。
 * 戻り値の recovered は「基準外の知らせを出していて、いま基準内に戻った」。
 */
export function decideAlerts(
  recentNewestFirst: Reading[],
  limits: Limits | null,
  sentAt: Partial<Record<AlertKind, string>>,
  now: Date,
): { send: AlertKind[]; recovered: boolean } {
  const send: AlertKind[] = [];
  const due = (k: AlertKind) => !sentAt[k] || now.getTime() - Date.parse(sentAt[k]!) >= ALERT_GAP_MS[k];
  const [cur, prev] = recentNewestFirst;
  let recovered = false;

  if (limits && cur) {
    const outNow = isOut(limits, cur.temp_c);
    const outPrev = prev ? isOut(limits, prev.temp_c) : false;
    if (outNow && outPrev && due("out_of_range")) send.push("out_of_range");
    if (!outNow && sentAt.out_of_range) recovered = true;
  }
  if (recentNewestFirst.length >= STALE_COUNT) {
    const w = recentNewestFirst.slice(0, STALE_COUNT);
    const same = w.every((r) => r.temp_c === w[0]!.temp_c && r.humidity === w[0]!.humidity);
    if (same && due("stale")) send.push("stale");
  }
  if (cur && nn(cur.battery) && cur.battery <= BATTERY_LOW && due("battery")) send.push("battery");
  return { send, recovered };
}

/** 2回以上続いた基準外の区間（古い順に渡す） */
export function excursions(oldestFirst: Reading[], limits: Limits): { from: string; to: string; peak: number }[] {
  const out: { from: string; to: string; peak: number }[] = [];
  let run: Reading[] = [];
  const flush = () => {
    if (run.length >= 2) {
      // 上限のある設備（冷蔵・冷凍）はいちばん高かった値、下限だけの設備はいちばん低かった値
      const ts = run.map((r) => r.temp_c);
      const peak = nn(limits.maxC) ? Math.max(...ts) : Math.min(...ts);
      out.push({ from: run[0]!.read_at, to: run.at(-1)!.read_at, peak });
    }
    run = [];
  };
  for (const r of oldestFirst) {
    if (isOut(limits, r.temp_c)) run.push(r);
    else flush();
  }
  flush();
  return out;
}

const hmJst = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(11, 16);

/**
 * 毎晩の自動記録に書く内容。その営業日の読み取り値（古い順）から。値が1つも無ければ null（記録しない）。
 */
export function dailyRecord(
  oldestFirst: Reading[],
  limits: Limits,
): { result: "ok" | "ng"; temp_c: number; measured_at: string; note: string } | null {
  if (oldestFirst.length === 0) return null;
  const last = oldestFirst.at(-1)!;
  const temps = oldestFirst.map((r) => r.temp_c);
  const lo = Math.min(...temps);
  const hi = Math.max(...temps);
  const ex = excursions(oldestFirst, limits);
  const lastOut = isOut(limits, last.temp_c);
  const parts = [`温度計で自動記録（${oldestFirst.length}回測定・最低${lo}℃／最高${hi}℃）`];
  if (ex.length > 0) {
    parts.push(`基準外が続いた時間：${ex.map((e) => `${hmJst(e.from)}〜${hmJst(e.to)}（最大${e.peak}℃）`).join("、")}`);
  }
  if (lastOut) parts.push(`記録時点で基準外（${last.temp_c}℃）`);
  return {
    result: ex.length > 0 || lastOut ? "ng" : "ok",
    temp_c: last.temp_c,
    measured_at: last.read_at,
    note: parts.join("。"),
  };
}

/** 営業日（朝4時区切り）の始まり：その日の 04:00 JST（ISO） */
export const bizDayStartIso = (bizDate: string): string => new Date(`${bizDate}T04:00:00+09:00`).toISOString();

export function alertText(kind: AlertKind | "recovered", name: string, r: Reading | null, limits: Limits | null): string {
  const lim = limits ? [nn(limits.maxC) ? `${limits.maxC}℃以下` : "", nn(limits.minC) ? `${limits.minC}℃以上` : ""].filter(Boolean).join("・") : "";
  switch (kind) {
    case "out_of_range":
      return `🌡⚠ ${name}が基準（${lim}）を外れています：いま${r?.temp_c}℃（30分以上続いています）\n扉の閉め忘れ・故障がないか見てください。衛生管理の計画どおりに対応し、アプリの「衛生」に記録してください。`;
    case "recovered":
      return `🌡✓ ${name}は基準内に戻りました：いま${r?.temp_c}℃`;
    case "stale":
      return `🌡？ ${name}の温度計の値が3時間以上変わっていません（${r?.temp_c}℃のまま）。ハブ（Hub Mini）の電源・Wi-Fi、温度計の電池を確かめてください。`;
    case "battery":
      return `🔋 ${name}の温度計の電池が少なくなっています（${r?.battery}%）。早めに交換してください。`;
    case "error":
      return `🌡？ ${name}の温度計が読めませんでした。SwitchBotアプリで温度計が表示されているか確かめてください。`;
  }
}
