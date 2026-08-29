// LINE公式アカウントに「ネット予約」リッチメニューを設定する(単発実行用)。
// GitHub Actions(.github/workflows/line-richmenu.yml)から実行する。
//
// やること:
//   1. リッチメニュー(トーク画面下の常設ボタン)を作成
//   2. scripts/line-richmenu.png をボタンの絵として登録
//   3. 友だち全員の既定メニューに設定
//
// リンク先は、LIFF(LINE内でログイン済みのまま開ける入口)が見つかれば
// それを、見つからなければ通常の予約URLを使う。

import { readFileSync } from "node:fs";

const TOKEN = process.env.LINE_TOKEN;
if (!TOKEN) {
  console.error("LINE_TOKEN がありません");
  process.exit(1);
}
const H = { Authorization: `Bearer ${TOKEN}` };
// LIFF(LINE内でログイン済みのまま開ける入口・店主提供 2026-08-29)。
// LINEの中ではSMS認証なしでそのまま予約でき、外のブラウザで開かれた場合は
// LIFF側が通常の予約ページへ流す。
const url = "https://liff.line.me/2011165284-tCUpXCUg";
console.log("リンク先:", url);

// 既存のリッチメニューを消してから作る(作り直しでゴミが残らないように)
const list = await fetch("https://api.line.me/v2/bot/richmenu/list", { headers: H });
if (list.ok) {
  for (const m of (await list.json()).richmenus ?? []) {
    await fetch(`https://api.line.me/v2/bot/richmenu/${m.richMenuId}`, { method: "DELETE", headers: H });
    console.log("旧メニューを削除:", m.richMenuId);
  }
}

// 1) リッチメニュー作成
const create = await fetch("https://api.line.me/v2/bot/richmenu", {
  method: "POST",
  headers: { ...H, "content-type": "application/json" },
  body: JSON.stringify({
    size: { width: 2500, height: 843 },
    selected: true, // トークを開いたら最初から開いた状態で出す
    name: "net-reserve-2026-08",
    chatBarText: "ネット予約はこちら",
    areas: [
      {
        bounds: { x: 0, y: 0, width: 2500, height: 843 },
        action: { type: "uri", label: "ネット予約", uri: url },
      },
    ],
  }),
});
if (!create.ok) {
  console.error("作成失敗:", create.status, await create.text());
  process.exit(1);
}
const { richMenuId } = await create.json();
console.log("richMenuId:", richMenuId);

// 2) ボタンの絵を登録
const img = readFileSync(new URL("./line-richmenu.png", import.meta.url));
const up = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
  method: "POST",
  headers: { ...H, "content-type": "image/png" },
  body: img,
});
if (!up.ok) {
  console.error("画像アップロード失敗:", up.status, await up.text());
  process.exit(1);
}
console.log("画像OK");

// 3) 友だち全員の既定メニューに
const def = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
  method: "POST",
  headers: H,
});
if (!def.ok) {
  console.error("既定メニュー設定失敗:", def.status, await def.text());
  process.exit(1);
}
console.log("設定完了: 友だち全員のトーク画面下に「ネット予約」ボタンが出ます");
