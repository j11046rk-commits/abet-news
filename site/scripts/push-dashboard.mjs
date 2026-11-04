// ビルド後の dist/dashboard/index.html を店舗管理アプリ（yoyaku.shipporitei.jp）へ送り、
// 公開するHP側の /dashboard は「店舗管理アプリで開いてください」の案内に置き換える（店主要望 2026-11-04）。
//
// これまでは合言葉で暗号化して公開していた（encrypt-dashboard.mjs・廃止）。
// これからは、店舗管理アプリにログインしている人だけが /hp-dashboard で見る。
//
// ★生のダッシュボードを公開側に残さないことが一番大事。
//   読み込んだらすぐ案内ページで上書きし、送るのはそのあと。送れなくてもビルドは止めない
//   （店舗管理アプリには前回届いた版が表示されたままになる）。
//
// 環境変数：
//   RESERVE_INSIGHTS_TOKEN … 店舗管理アプリの INSIGHTS_TOKEN と同じ値（GitHub Actions secret）
//   DASHBOARD_PUSH_URL     … 既定 https://yoyaku.shipporitei.jp/api/insights/hp-dashboard
//   PUBLIC_SITE_URL        … 画像の読み込み元。既定 https://shipporitei.jp
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const target = path.join(DIST, "dashboard", "index.html");
const APP_URL = "https://yoyaku.shipporitei.jp/hp-dashboard";
const PUSH_URL = (process.env.DASHBOARD_PUSH_URL || "https://yoyaku.shipporitei.jp/api/insights/hp-dashboard").trim();
const TOKEN = (process.env.RESERVE_INSIGHTS_TOKEN || "").trim();
const SITE = (process.env.PUBLIC_SITE_URL || "https://shipporitei.jp").replace(/\/$/, "");
const BASE = (process.env.BASE_PATH || "").replace(/\/$/, "");

let html;
try {
  html = await readFile(target, "utf8");
} catch {
  console.log("dist/dashboard/index.html が無いので何もしません。");
  process.exit(0);
}

// 1) 公開側はすぐ案内ページにする
await writeFile(
  target,
  `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<meta http-equiv="refresh" content="0; url=${APP_URL}" />
<title>アクセス管理ダッシュボード</title>
</head>
<body style="font-family:-apple-system,'Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;background:#111726;color:#eef1f8;padding:2rem;line-height:1.8">
<p>アクセス管理ダッシュボードは、しっぽり亭店舗管理アプリの中に移りました。</p>
<p><a style="color:#e6c391" href="${APP_URL}">店舗管理アプリで開く</a>（ログインしている人だけが見られます）</p>
</body>
</html>
`,
);
console.log("公開側の /dashboard を案内ページに置き換えました。");

// 2) 店舗管理アプリの中で崩れないよう、CSS は中に埋め込み、画像は公開サイトから読む
const strip = (p) => (BASE && p.startsWith(BASE + "/") ? p.slice(BASE.length) : p);
const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"\s*\/?>/g)];
for (const m of links) {
  const href = m[1];
  if (!href.startsWith("/")) continue;
  try {
    const css = await readFile(path.join(DIST, strip(href)), "utf8");
    html = html.replace(m[0], `<style>${css}</style>`);
  } catch {
    console.warn(`CSS を埋め込めませんでした: ${href}`);
  }
}
html = html.replace(/(src|href)="\/(?!\/)/g, (_, a) => `${a}="${SITE}${BASE}/`);

if (!TOKEN) {
  console.warn("RESERVE_INSIGHTS_TOKEN 未設定のため、店舗管理アプリへは送りません。");
  process.exit(0);
}
try {
  const res = await fetch(PUSH_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": TOKEN },
    body: JSON.stringify({ html, built_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(30000),
  });
  console.log(res.ok ? `店舗管理アプリへ送りました（${html.length} 文字）。` : `店舗管理アプリへの送信に失敗: HTTP ${res.status}`);
} catch (e) {
  console.warn(`店舗管理アプリへの送信に失敗: ${e?.name ?? e}`);
}
