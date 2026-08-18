import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { LINE_USER_ID_RE, verifyLineSignature } from "@/lib/line-login";
import { pushLine, pushLineUser } from "@/lib/line";

/**
 * LINEからの通知の受け口（友だち追加・ブロック・トークのメッセージ）。
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
};

/** お客様がトークに書いてくださったときの返事。人が読むまでの「受け取りました」 */
const REPLY =
  "メッセージをありがとうございます。\n" +
  "ご予約の変更・キャンセルは、お店の者が確認してご連絡いたします。\n" +
  "お急ぎの場合は 0897-47-4494 までお電話ください。";

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
        // 行は消さない。消すと「一度も友だちでなかった人」と区別がつかなくなり、
        // 送ってはいけない相手にまた送ることになる。
        await admin
          .from("line_friends")
          .update({ unfollowed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("line_user_id", userId);
      } else if (ev.type === "message" && ev.message?.type === "text") {
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
         * お客様からの連絡は、店のグループへ流して人が見る。
         * 自動で予約を書き換えることはしない——「20時に変更で」と書かれても、
         * 席が空いているかは店にしか分からない。機械が勝手に動くより、
         * 人が見て直すほうが確実で、間違えたときに気づける。
         */
        const text = (ev.message.text ?? "").slice(0, 200);
        await pushLine(`【公式LINEにメッセージ】\n${text}\n\n（アプリの予約一覧からご対応ください）`);
        await pushLineUser(userId, REPLY);
      }
    } catch (e) {
      // 1件で転んでも残りは処理する。LINEには必ず200を返す
      console.error("line_webhook_event_failed", ev.type, e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ ok: true });
}
