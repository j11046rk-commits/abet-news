import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushLineUser } from "@/lib/line";
import {
  fmtDate,
  fmtDateJa,
  isoToMinutes,
  minutesToLabel,
  nowJst,
  shiftDate,
  todayBizDate,
} from "@/lib/time";

/**
 * 前日リマインド（1日1回・夕方に、明日ご来店のお客様へ）。
 *
 * 無断キャンセルにいちばん効くのは、認証を厳しくすることではなく
 * 「明日ですよ」と一声かけることだと考えている。忘れているだけの人は、
 * 声をかければ来るか、来られないと言ってくれる。どちらでも店は助かる。
 *
 * 送る相手は、LINEで予約されたお客様だけ（電話番号しか無い方には送れない）。
 *
 * ★当日にお入れいただいた予約には送らない（店主指示）。
 *   今日ご予約くださった方には、その場で控えをお送りしている。
 *   同じ日に2通目が届くのは、案内ではなく催促に見える。
 *   忘れようがない人に念を押さないのが礼儀だし、通数も無駄にしない。
 *
 * ★送った印を予約1件ごとに残す（reminded_at）。
 *   定期実行は「1日1回きっかり」ではない。動かなかった日に手で叩くこともある。
 *   印が無いと、同じ文面が2通並ぶ——予約の連絡としては一番信用を落とす形。
 *   1件ごとに印を付けるので、途中で失敗しても次に走ったとき残りから再開できる。
 */

type Row = {
  id: string;
  biz_date: string;
  starts_at: string;
  party_size: number;
  status: string;
  line_user_id: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "認証できません。" }, { status: 401 });
  }

  const today = todayBizDate();
  const target = shiftDate(today, 1); // 明日ご来店のぶん
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("reservations")
    .select("id, biz_date, starts_at, party_size, status, line_user_id, created_at")
    .eq("biz_date", target)
    .in("status", ["tentative", "confirmed"])
    .not("line_user_id", "is", null)
    .is("reminded_at", null);

  if (error) {
    console.error("remind_query_failed", error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const rows = (data ?? []) as Row[];

  // ブロックされた方には送らない。送っても届かないうえ、通数だけ減る
  const ids = rows.map((r) => r.line_user_id).filter((v): v is string => !!v);
  const blocked = new Set<string>();
  if (ids.length > 0) {
    const { data: friends } = await admin
      .from("line_friends")
      .select("line_user_id, unfollowed_at")
      .in("line_user_id", ids);
    for (const f of (friends ?? []) as { line_user_id: string; unfollowed_at: string | null }[]) {
      if (f.unfollowed_at) blocked.add(f.line_user_id);
    }
  }

  let sent = 0;
  let skipped = 0;

  for (const r of rows) {
    /*
     * 当日にお入れいただいた予約は飛ばす（＝今日ご予約で、明日ご来店の方）。
     *
     * 日本時間の暦日で比べる。UTCのまま比べると、夜に手で動かしたときだけ
     * 前日として判定され、送るはずのない人に届く（時差の9時間ぶんずれる）。
     */
    const bookedToday = fmtDate(r.created_at) === fmtDate(nowJst());
    if (!r.line_user_id || blocked.has(r.line_user_id) || bookedToday) {
      skipped += 1;
      continue;
    }

    const when = `${fmtDateJa(`${r.biz_date}T12:00:00+09:00`)} ${minutesToLabel(
      isoToMinutes(r.biz_date, r.starts_at),
    )}`;

    const ok = await pushLineUser(
      r.line_user_id,
      [
        "明日のご予約をお待ちしております。",
        "しっぽり亭です。",
        "",
        when,
        `${r.party_size}名様`,
        "",
        "ご都合が変わりましたら、このトークにご連絡ください。",
        "お急ぎの場合は 0897-47-4494 までお電話ください。",
      ].join("\n"),
    );

    if (ok) {
      // 送れた人にだけ印を付ける。届かなかった人は次の機会に回る
      await admin.from("reservations").update({ reminded_at: new Date().toISOString() }).eq("id", r.id);
      sent += 1;
    } else {
      skipped += 1;
    }
  }

  return NextResponse.json({ ok: true, date: target, target: rows.length, sent, skipped });
}
