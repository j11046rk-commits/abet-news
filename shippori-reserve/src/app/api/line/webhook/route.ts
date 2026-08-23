import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { LINE_USER_ID_RE, verifyLineSignature } from "@/lib/line-login";
import { pushLine, replyLineUser } from "@/lib/line";

/**
 * LINEからの通知の受け口（友だち追加・ブロック・トークのメッセージ）。
 *
 * ★受けるのは**お客様向けアカウント**（しっぽり亭 家庭料理おばんざい居酒屋）の通知。
 *   お客様が友だち追加するのはこちらで、店のレポート用アカウントとは別物。
 *   お客様への自動返信も同じアカウントから返す（pushLineUser）。
 *   店への申し送りだけ、いつものレポート用グループへ流す（pushLine）。
 *
 * ★必ず 200 を返す。
 *   LINEは失敗した通知を何度も送り直し、続くと配信自体を止めてしまう。
 *   こちらの都合（DBが一瞬詰まった等）で友だちの記録が壊れるより、
 *   1件取りこぼすほうが軽い。中で起きたことはログに残す。
 *
 * ★署名を確かめてから中身を読む。
 *   URLは誰でも叩けるので、確かめないと偽の「友だちになりました」を入れられる。
 *   名簿が汚れると、送ってはいけない相手に送る事故になる。
 */

type LineEvent = {
  type: string;
  source?: { userId?: string; type?: string };
  message?: { type?: string; text?: string };
  timestamp?: number;
  /** 返信用の一度きりの引換券。reply はプッシュと違い通数を消費しない */
  replyToken?: string;
  /** LINE側の再送か。再送に送り返すと、お客様のトークに同じ返事が2つ並ぶ */
  deliveryContext?: { isRedelivery?: boolean };
};

/** お客様がトークに書いてくださったときの返事。人が読むまでの「受け取りました」 */
const REPLY =
  "メッセージをありがとうございます。\n" +
  "ご予約の変更・キャンセルは、お店の者が確認してご連絡いたします。\n" +
  "お急ぎの場合は 0897-47-4494 までお電話ください。";

/** 自動返信の間隔（同じ人には1時間に1回まで）。連投のたびに返すのは機械の連呼にしかならない */
const REPLY_GAP_MS = 60 * 60_000;

export async function POST(request: Request) {
  // 署名はリクエストの本文そのものに対して作られているので、先に文字列で受ける
  const raw = await request.text();
  const ok = await verifyLineSignature(raw, request.headers.get("x-line-signature"));
  if (!ok) {
    // ここだけは 401 を返す。偽物に「受け取った」と答える必要はない
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let events: LineEvent[] = [];
  try {
    events = (JSON.parse(raw)?.events ?? []) as LineEvent[];
  } catch {
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();

  for (const ev of events) {
    const userId = (ev.source?.userId ?? "").trim();
    if (!LINE_USER_ID_RE.test(userId)) continue;

    try {
      if (ev.type === "follow") {
        // 友だち追加。前にブロックされていた人が戻ることもあるので、解除を消しておく
        await admin.from("line_friends").upsert(
          {
            line_user_id: userId,
            followed_at: new Date().toISOString(),
            unfollowed_at: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "line_user_id" },
        );
      } else if (ev.type === "unfollow") {
        /*
         * 行は消さない。消すと「一度も友だちでなかった人」と区別がつかなくなり、
         * 送ってはいけない相手にまた送ることになる。
         *
         * ★update ではなく upsert。
         *   webhookを入れる前からの友だち（生ビールクーポンで集めた方々）は
         *   名簿に行が無い。その人がブロックすると、update は0行に当たって
         *   何も記録されず、「ブロックした人に送り続ける」名簿になる——
         *   この名簿の存在理由そのものが壊れる。行が無ければ作って印を付ける。
         *   （followed_at は本当の追加日時が分からないので登録時刻が入る。
         *     unfollowed_at が入っている行では使わないので実害はない）
         */
        await admin.from("line_friends").upsert(
          {
            line_user_id: userId,
            unfollowed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "line_user_id" },
        );
      } else if (ev.type === "message" && ev.message?.type === "text" && ev.source?.type === "user") {
        // source.type を見るのは、ボットがグループに入れられたときのため。
        // グループの雑談を「お客様からの連絡」として店へ流し、発言者の個人トークに
        // 自動返信が飛ぶ——という誤動作を、1対1のトークだけに絞って防ぐ。

        // 前回いつ書いてくれたかを、上書きする前に読む（自動返信の間引きに使う）
        const { data: prev } = await admin
          .from("line_friends")
          .select("last_message_at")
          .eq("line_user_id", userId)
          .maybeSingle<{ last_message_at: string | null }>();

        await admin
          .from("line_friends")
          .upsert(
            {
              line_user_id: userId,
              last_message_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "line_user_id" },
          );

        /*
         * LINE側の再送（届け直し）には送り返さない。名簿の更新は済ませる
         * （upsertなので何度来ても同じ）が、転送と返信をもう一度やると
         * 店のグループに同じ連絡が2つ並び、お客様にも同じ返事が2通届く。
         */
        if (ev.deliveryContext?.isRedelivery === true) continue;

        /*
         * お客様からの連絡は、店のグループへ流して人が見る。
         * 自動で予約を書き換えることはしない——「20時に変更で」と書かれても、
         * 席が空いているかは店にしか分からない。機械が勝手に動くより、
         * 人が見て直すほうが確実で、間違えたときに気づける。
         */
        const text = (ev.message.text ?? "").slice(0, 200);
        await pushLine(
          `【お客様の公式LINEにメッセージ】\n${text}\n\n（アプリの予約一覧からご対応ください）`,
        );

        /*
         * 自動返信は reply（無料）で返す。push で返すと1通ずつ月200通の枠が減り、
         * 連投されるだけで「ご予約の控え」の枠まで枯れる。
         * 同じ人には1時間に1回まで——「明日」「2名」「19時で」と3通に分けて
         * 書く人に、機械が3回同じ挨拶を返さない。
         */
        const last = prev?.last_message_at ? new Date(prev.last_message_at).getTime() : 0;
        if (Date.now() - last > REPLY_GAP_MS && ev.replyToken) {
          await replyLineUser(ev.replyToken, REPLY);
        }
      }
    } catch (e) {
      // 1件で転んでも残りは処理する。LINEには必ず200を返す
      console.error("line_webhook_event_failed", ev.type, e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ ok: true });
}
