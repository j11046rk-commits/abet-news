/**
 * しっぽり亭 ストーリー告知リマインダー
 *
 * 店長のLINEへ、インスタのストーリー更新依頼を投げるだけのWorker。
 * 完了確認も再送もしない（送りっぱなし）。
 *
 *   月曜 00:30 JST  … 定休日告知    （毎週。休みの日でも翌週の告知は要る）
 *   営業日 17:45 JST … おすすめ告知  （開店前。定休日・臨時休業はスキップ）
 *
 * 「今日が営業日か」は予約システム（shippori-reserve）に聞く。
 * 火曜定休はそちらの settings.closed_weekdays が正で、臨時休業も
 * business_days に入っているので、ここには曜日を持たない。
 *
 * 必要なSecrets:
 *   LINE_CHANNEL_ACCESS_TOKEN ... Messaging APIのチャネルアクセストークン
 *   TARGET_ID                 ... 送信先。個人ならuserId(U...)、グループならgroupId(C...)
 *   TEST_KEY                  ... /test-push を叩くときの合言葉
 *   BUSINESS_DAY_API_URL      ... 例 https://yoyaku.shipporitei.jp/api/public/business-day
 *   BUSINESS_DAY_TOKEN        ... 予約システム側の BUSINESS_DAY_TOKEN と同じ値
 */

// 画像をGitHubのpublicリポジトリに置いた後、このURLを差し替える。
// LINEの画像メッセージは HTTPS必須・JPEGかPNG・最大10MB。
const TEIKYUBI_IMAGE_URL =
  "https://raw.githubusercontent.com/YOUR_NAME/YOUR_REPO/main/teikyubi_story.png";
const OSUSUME_IMAGE_URL =
  "https://raw.githubusercontent.com/YOUR_NAME/YOUR_REPO/main/osusume_story.png";

/**
 * cron式 → 送る中身。wrangler.toml の crons と1対1で対応させること。
 * scheduled() には発火した cron 式がそのまま渡ってくるので、それで引く。
 */
const JOBS = {
  // 日曜 15:30 UTC = 月曜 00:30 JST
  "30 15 * * 0": {
    name: "teikyubi",
    text: "@ゆうと　今週もお疲れ様でした。定休日告知ストーリー更新お願いします！",
    imageUrl: TEIKYUBI_IMAGE_URL,
    businessDayOnly: false,
  },
  // 毎日 08:45 UTC = 17:45 JST（営業日だけ送る）
  "45 8 * * *": {
    name: "osusume",
    text: "@ゆうと　お疲れ様です。開店前ストーリー、本日のおすすめストーリー告知をお願いします。",
    imageUrl: OSUSUME_IMAGE_URL,
    businessDayOnly: true,
  },
};

const JOBS_BY_NAME = Object.fromEntries(Object.values(JOBS).map((j) => [j.name, j]));

/** 今日の日付（JST）を YYYY-MM-DD で返す */
function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * その日が休業日か予約システムに聞く。
 *
 * 判定できなかったときは false（＝営業日扱い）を返して送信を通す。
 * リマインドが1回余計に飛ぶのと、店長が告知を忘れるのとでは後者のほうが痛い。
 * 予約システムが落ちている・URL未設定、はどちらも送る側に倒す。
 */
async function isClosedDay(env, date) {
  if (!env.BUSINESS_DAY_API_URL || !env.BUSINESS_DAY_TOKEN) {
    console.log("business-day: 未設定のため営業日として扱う");
    return false;
  }

  try {
    const res = await fetch(
      `${env.BUSINESS_DAY_API_URL}?date=${encodeURIComponent(date)}`,
      {
        headers: { "x-api-key": env.BUSINESS_DAY_TOKEN },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      console.log(`business-day: ${res.status} ${await res.text()} → 営業日として扱う`);
      return false;
    }
    const day = await res.json();
    return day.is_closed === true;
  } catch (e) {
    console.log(`business-day: 取得できず(${e}) → 営業日として扱う`);
    return false;
  }
}

async function pushToLine(env, job) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to: env.TARGET_ID,
      messages: [
        { type: "text", text: job.text },
        {
          type: "image",
          originalContentUrl: job.imageUrl,
          previewImageUrl: job.imageUrl,
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`LINE push failed: ${res.status} ${detail}`);
  }
}

/** 営業日チェック込みで1本送る。送ったかどうかを文字列で返す（ログと /test-push 用）。 */
async function runJob(env, job, { force = false } = {}) {
  if (job.businessDayOnly && !force) {
    const date = todayJst();
    if (await isClosedDay(env, date)) {
      return `skipped: ${date} は休業日 (${job.name})`;
    }
  }
  await pushToLine(env, job);
  return `pushed: ${job.name}`;
}

export default {
  async scheduled(event, env, ctx) {
    const job = JOBS[event.cron];
    if (!job) {
      // wrangler.toml に cron を足して JOBS に入れ忘れた場合ここに来る
      throw new Error(`未対応のcronです: ${event.cron}`);
    }
    console.log(await runJob(env, job));
  },

  // デバッグ用: cronを待たずに手動で発火させる
  //   /test-push?key=合言葉              … 定休日告知を送る
  //   /test-push?key=合言葉&job=osusume  … おすすめ告知を送る（休業日ならスキップ）
  //   ...&force=1                        … 営業日チェックを飛ばして必ず送る
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/test-push" && url.searchParams.get("key") === env.TEST_KEY) {
      const name = url.searchParams.get("job") || "teikyubi";
      const job = JOBS_BY_NAME[name];
      if (!job) {
        const known = Object.keys(JOBS_BY_NAME).join(", ");
        return new Response(`unknown job: ${name} (使えるのは ${known})`, { status: 400 });
      }
      try {
        const result = await runJob(env, job, { force: url.searchParams.get("force") === "1" });
        return new Response(result, { status: 200 });
      } catch (e) {
        return new Response(String(e), { status: 500 });
      }
    }
    return new Response("ok", { status: 200 });
  },
};
