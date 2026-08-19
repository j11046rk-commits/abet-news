import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { broadcastLineCustomers, pushLine } from "@/lib/line";
import { customerQuota, customerReach, RESERVED_FOR_BOOKINGS } from "@/lib/line-quota";
import { CLOSED_WEEKDAYS } from "@/lib/constants";
import { isHoliday } from "@/lib/holidays";
import { fmtDateJa, shiftDate, todayBizDate, weekdayOf } from "@/lib/time";

/**
 * 静かな日のクーポン（毎日13時・予約ゼロの日だけ）。
 *
 * 13時の時点でその日の予約が1件も無ければ、公式LINEの友だち全員に
 * 「本日限定 生ビール or ハイボール 1杯無料」を配信して空席を埋めにいく（店主要望 2026-08）。
 *
 * ★これは攻めの機能で、守りの機能ではない。だから「迷ったら送らない」に倒す。
 *   予約の控えやリマインドは「送れないと困る」ものだが、クーポンは
 *   「送りすぎると困る」もの。向きが逆なので、判定の倒し方も逆にしてある。
 *
 * 送らない条件（上から順に見る）:
 *   ① QUIET_COUPON_ENABLED が "1" でない … 動き出しの日を店主が決める
 *   ② 休業日・イベント日 … 誰も来られない日に「来てください」は事故
 *   ③ 金・土・祝日の前日 … 予約ゼロでも送らない（店主指定 2026-08-20）。
 *      もともと人が入る夜にクーポンを撒くと、どのみち来た人を値引きするだけになり、
 *      粗利が減る方向にしか働かない。静かな日を埋める道具は、静かな日にだけ使う
 *   ④ 予約が1件でもある … 店主指定の条件そのまま
 *   ⑤ 前回の配信から7日たっていない … 静かな日が続く週に毎日届くと、
 *      案内ではなく安売りの連発に見えて、ブロックが増える
 *   ⑥ 今月すでに4回配信している … ⑤だけだと月初から刻んだ月に5回入る
 *      （1日・8日・15日・22日・29日）。「月4回まで」は別の上限として持つ（店主指定）
 *   ⑦ 残り通数が読めない・足りない … 配信は1回で友だちの人数ぶんを使う。
 *      ここで使い切ると、予約の控え（絶対に届けたいもの）が月末に止まる
 *
 * ⑦で止めたときは店のグループに知らせる。黙って止まる仕組みにしない。
 * （⑤⑥は「決めたとおりに間を空けているだけ」なので、毎回知らせない）
 */

/** 前回の配信からこれだけ空ける（日）。変えたいときはここを直す（店主指定 2026-08） */
const GAP_DAYS = 7;
/** ひと月の配信の上限（店主指定 2026-08）。7日間隔だけだと月初から刻んだ月に5回入る */
const MONTHLY_CAP = 4;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "認証できません。" }, { status: 401 });
  }

  // ① 店主がオンにするまで動かない（配り始める日は人が決める）
  if (process.env.QUIET_COUPON_ENABLED !== "1") {
    return NextResponse.json({ ok: true, skipped: "off" });
  }

  const today = todayBizDate();
  const admin = createAdminClient();

  // ② 休業日・イベント日は送らない。営業日の行が無い日は火曜定休だけ見る
  const { data: day } = await admin
    .from("business_days")
    .select("is_closed, mode")
    .eq("biz_date", today)
    .maybeSingle<{ is_closed: boolean; mode: string }>();
  if (day ? day.is_closed : CLOSED_WEEKDAYS.includes(weekdayOf(today))) {
    return NextResponse.json({ ok: true, skipped: "closed" });
  }
  if (day?.mode === "event") {
    return NextResponse.json({ ok: true, skipped: "event" });
  }

  /*
   * ③ 金・土と祝日の前日は、予約ゼロでも送らない（店主指定）。
   *   「祝日の前日」＝翌日が休みの夜は、金土と同じく放っておいても人が入る。
   *   翌日そのものが祝日かではなく、**翌日が祝日か**で見るのがみそ。
   */
  const dow = weekdayOf(today);
  if (dow === 5 || dow === 6 || isHoliday(shiftDate(today, 1))) {
    return NextResponse.json({ ok: true, skipped: "busy-day", dow });
  }

  // ④ 予約が1件でもあれば送らない（店主指定の条件）
  const { count, error } = await admin
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("biz_date", today)
    .in("status", ["tentative", "confirmed", "seated"]);
  if (error) {
    console.error("quiet_day_count_failed", error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json({ ok: true, skipped: "has-reservations", count });
  }

  // ⑤ 前回から7日空ける
  const { data: last } = await admin
    .from("line_broadcasts")
    .select("sent_at")
    .eq("kind", "quiet_day")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ sent_at: string }>();
  if (last && Date.now() - new Date(last.sent_at).getTime() < GAP_DAYS * 86400_000) {
    return NextResponse.json({ ok: true, skipped: "too-soon", last: last.sent_at });
  }

  // ⑥ 月4回まで。月の区切りは日本時間の暦月で数える
  const monthStart = `${today.slice(0, 7)}-01T00:00:00+09:00`;
  const { count: sentThisMonth } = await admin
    .from("line_broadcasts")
    .select("id", { count: "exact", head: true })
    .eq("kind", "quiet_day")
    .gte("sent_at", new Date(monthStart).toISOString());
  if ((sentThisMonth ?? 0) >= MONTHLY_CAP) {
    return NextResponse.json({ ok: true, skipped: "monthly-cap", sent_this_month: sentThisMonth });
  }

  /*
   * ⑦ 通数。配信は「友だちの人数ぶん」を一気に使う。
   *
   * ★分からないときは**送らない**（リマインドと逆向き）。
   *   リマインドは1通ずつなので、読めない日に送っても被害は小さい。
   *   配信は読めないまま送ると、200通の枠を一撃で使い切りうる——
   *   そうなると予約の控え（絶対に届けたいもの）が月末に止まる。
   */
  const [quota, reach] = await Promise.all([customerQuota(), customerReach()]);
  if (reach === null || reach === 0) {
    return NextResponse.json({ ok: true, skipped: "no-reach", reach });
  }
  if (quota?.remaining == null || quota.remaining - reach < RESERVED_FOR_BOOKINGS) {
    await pushLine(
      [
        "⚠️ 本日のクーポン配信を見送りました（LINEの残り通数が足りません）。",
        `友だち ${reach} 名 / 残り ${quota?.remaining ?? "不明"} 通`,
        "",
        "ご予約の控えを優先しています。プランの変更をご検討ください。",
      ].join("\n"),
    );
    return NextResponse.json({ ok: true, skipped: "quota", reach, remaining: quota?.remaining ?? null });
  }

  /*
   * 文面。「本日ご来店ぶんに限る」と日付を入れる——画面の提示で使い回しを防ぐため。
   * QUIET_COUPON_URL（LINE公式アカウントの管理画面で作ったクーポン）があれば
   * そちらを案内し、無ければこの画面の提示で成立する形にする。
   */
  const couponUrl = (process.env.QUIET_COUPON_URL ?? "").trim();
  const dateJa = fmtDateJa(`${today}T12:00:00+09:00`);
  const text = [
    "こんばんは、しっぽり亭です🍺",
    "",
    "本日、お席にゆとりがあります。",
    `【${dateJa} 限定】生ビール または ハイボール 1杯無料！`,
    "",
    couponUrl !== "" ? `クーポンはこちら\n${couponUrl}` : "ご来店時にこの画面をご提示ください。",
    "",
    "ご予約はこちらから",
    // LIFFのURL。配信はLINEのトークに届く＝受け取る人は全員LINEの中にいるので、
    // ふつうのURLで一度外に出すより、LINEの中で開く入口へ直行させる
    // （名前の自動入力・SMS省略が最初から効く）。LIFF IDは環境変数から。
    process.env.NEXT_PUBLIC_LIFF_ID
      ? `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}`
      : "https://yoyaku.shipporitei.jp/yoyaku",
    "お電話 0897-47-4494",
  ].join("\n");

  const sent = await broadcastLineCustomers(text);
  if (!sent) {
    await pushLine("⚠️ 本日のクーポン配信に失敗しました（LINEへの送信エラー）。");
    return NextResponse.json({ ok: false, reach }, { status: 500 });
  }

  // 記録してから店に知らせる。記録が先——知らせに失敗しても、7日の間隔は守られる
  await admin.from("line_broadcasts").insert({
    kind: "quiet_day",
    reach,
    note: `${today} 予約0件のため自動配信`,
  });
  await pushLine(
    [
      `📣 本日（${dateJa}）のクーポンを配信しました。`,
      `友だち ${reach} 名へ / 予約0件のため`,
      "",
      "1杯無料（生ビール or ハイボール・本日限定）です。ご来店時の提示をご確認ください。",
    ].join("\n"),
  );

  return NextResponse.json({ ok: true, sent: true, reach });
}
