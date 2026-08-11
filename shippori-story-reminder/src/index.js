/**
 * しっぽり亭 定休日ストーリー告知リマインダー
 *
 * 毎週月曜 00:30 JST に、店長のLINEへ
 * 「インスタストーリーの定休日告知をお願いします」を画像付きで送るだけのWorker。
 * 完了確認も再送もしない（送りっぱなし）。
 *
 * 必要なSecrets:
 *   LINE_CHANNEL_ACCESS_TOKEN ... Messaging APIのチャネルアクセストークン
 *   TARGET_ID                 ... 送信先。個人ならuserId(U...)、グループならgroupId(C...)
 *   TEST_KEY                  ... /test-push を叩くときの合言葉
 */

// 画像をGitHubのpublicリポジトリに置いた後、このURLを差し替える。
// LINEの画像メッセージは HTTPS必須・JPEGかPNG・最大10MB。
const IMAGE_URL =
  "https://raw.githubusercontent.com/YOUR_NAME/YOUR_REPO/main/teikyubi_story.png";

const MESSAGE_TEXT =
  "@ゆうと　今週もお疲れ様でした。定休日告知ストーリー更新お願いします！";

async function pushToLine(env) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to: env.TARGET_ID,
      messages: [
        { type: "text", text: MESSAGE_TEXT },
        {
          type: "image",
          originalContentUrl: IMAGE_URL,
          previewImageUrl: IMAGE_URL,
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`LINE push failed: ${res.status} ${detail}`);
  }
}

export default {
  async scheduled(event, env, ctx) {
    await pushToLine(env);
  },

  // デバッグ用: cronを待たずに手動で発火させる
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/test-push" && url.searchParams.get("key") === env.TEST_KEY) {
      try {
        await pushToLine(env);
        return new Response("pushed", { status: 200 });
      } catch (e) {
        return new Response(String(e), { status: 500 });
      }
    }
    return new Response("ok", { status: 200 });
  },
};
