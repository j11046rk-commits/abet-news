// しっぽり亭 管理ダッシュボード用に、予約システムの集計を取ってきて
// site/data/reserve.json を更新する。依存ゼロ。
//
// 取ってくるのは**集計だけ**。氏名も電話番号も含まれない
// （予約アプリ側の /api/insights/reservations が、そもそもその列を読んでいない）。
// ダッシュボードは静的HTMLとして配信されるので、ここに個人情報を混ぜてはいけない。
//
// 認証情報:
//   RESERVE_INSIGHTS_URL … 既定 https://yoyaku.shipporitei.jp/api/insights/reservations
//   RESERVE_INSIGHTS_TOKEN … 予約アプリの INSIGHTS_TOKEN と同じ値（GitHub Actions secret）
//
// 実行: node scripts/fetch-reserve.mjs   （site/ ディレクトリから）
//
// 取得に失敗しても、コミット済みの data/reserve.json でビルドは続く（GA4と同じ方針）。

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../data/reserve.json");
const URL_ = (process.env.RESERVE_INSIGHTS_URL || "https://yoyaku.shipporitei.jp/api/insights/reservations").trim();
const TOKEN = (process.env.RESERVE_INSIGHTS_TOKEN || "").trim();
const DAYS = Number(process.env.RESERVE_INSIGHTS_DAYS || 28);

/** 個人情報が混ざっていないかを、書き出す前にこちら側でも確かめる。
 *  相手を信用しない。列を足す変更が向こうで入っても、ここで止まる。 */
const FORBIDDEN = [
  "name", "phone", "tel", "kana", "memo", "allergy", "invoice",
  "reference", "customer", "email", "detail", "id",
];
function assertNoPii(value, trail = "$") {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoPii(v, `${trail}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const low = k.toLowerCase();
      if (FORBIDDEN.some((w) => low.includes(w))) {
        throw new Error(`個人情報らしき項目が混ざっています: ${trail}.${k}`);
      }
      assertNoPii(v, `${trail}.${k}`);
    }
  }
}

async function main() {
  if (!TOKEN) throw new Error("RESERVE_INSIGHTS_TOKEN 未設定");

  const res = await fetch(`${URL_}?days=${DAYS}`, {
    headers: { "x-api-key": TOKEN },
    // 予約アプリが寝ている（コールドスタート）ことがあるので少し待つ
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`予約インサイトの取得に失敗: HTTP ${res.status}`);

  const json = await res.json();
  if (!json || typeof json !== "object" || !json.totals) {
    throw new Error("返ってきた中身が想定と違います");
  }
  assertNoPii(json);

  await writeFile(OUT, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  console.log(
    `予約インサイトを更新: ${json.range?.from}〜${json.range?.to} ` +
      `／ 予約 ${json.totals.reservations}件・${json.totals.guests}名（うちネット ${json.totals.net}件）`,
  );
}

main().catch((e) => {
  console.error(`予約インサイトの取得に失敗: ${e.message}`);
  process.exit(1);
});
