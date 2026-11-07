// 指定した日（既定：今日）のアクセスの内訳をログに出す単発実行ツール。
// 「今日ネット予約が多いのはなぜか」を調べるため（店主要望 2026-11-04）。
// 出すのは集計値だけ（鍵やIDはログに出さない）。実行は ga4-day.yml（手動）から。
//   DAY=2026-11-04 COMPARE_FROM=2026-10-21 node scripts/ga4-day.mjs
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createSign } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DATA_API = "https://analyticsdata.googleapis.com/v1beta";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const num = (v) => Number(v || 0);
const b64url = (buf) => Buffer.from(buf).toString("base64url");

// --- 認証情報の解決（環境変数優先、無ければローカルの ga4.env） ---
async function resolveCreds() {
  let propertyId = process.env.GA4_PROPERTY_ID;
  let saKeyRaw = process.env.GA4_SA_KEY;
  let saKeyPath = process.env.GA4_SA_KEY_PATH;

  if (!propertyId || (!saKeyRaw && !saKeyPath)) {
    const envPath = path.join(homedir(), ".config/shippori-report/ga4.env");
    try {
      const txt = await readFile(envPath, "utf8");
      for (const line of txt.split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const val = m[2].replace(/^["']|["']$/g, "");
        if (m[1] === "GA4_PROPERTY_ID") propertyId ||= val;
        if (m[1] === "GA4_SA_KEY_PATH") saKeyPath ||= val;
      }
    } catch { /* ローカルenvが無ければ環境変数のみで続行 */ }
  }
  if (!propertyId) throw new Error("GA4_PROPERTY_ID 未設定");
  let sa;
  if (saKeyRaw) sa = JSON.parse(saKeyRaw);
  else if (saKeyPath) sa = JSON.parse(await readFile(saKeyPath, "utf8"));
  else throw new Error("GA4 サービスアカウント鍵が未設定（GA4_SA_KEY か GA4_SA_KEY_PATH）");
  return { propertyId, sa };
}

function buildAssertionJwt(sa, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = { iss: sa.client_email, scope: SCOPE, aud: TOKEN_ENDPOINT, iat, exp: iat + 3600 };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const sig = createSign("RSA-SHA256").update(input).sign(sa.private_key);
  return `${input}.${b64url(sig)}`;
}

async function getAccessToken(sa) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: buildAssertionJwt(sa),
    }).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GA4 トークン取得失敗: ${res.status} ${JSON.stringify(json)}`);
  return json.access_token;
}

async function runReport(propertyId, token, body) {
  const res = await fetch(`${DATA_API}/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GA4 runReport失敗: ${res.status} ${JSON.stringify(json)}`);
  return json;
}


const DAY = process.env.DAY || "today";
const FROM = process.env.COMPARE_FROM || "14daysAgo";

function table(rep) {
  const dims = (rep.dimensionHeaders || []).map((h) => h.name);
  const mets = (rep.metricHeaders || []).map((h) => h.name);
  return (rep.rows || []).map((r) => {
    const o = {};
    r.dimensionValues.forEach((v, i) => (o[dims[i]] = v.value));
    r.metricValues.forEach((v, i) => (o[mets[i]] = num(v.value)));
    return o;
  });
}

async function main() {
  const { propertyId, sa } = await resolveCreds();
  const token = await getAccessToken(sa);
  const run = (body) => runReport(propertyId, token, body).then(table);
  const day = [{ startDate: DAY, endDate: DAY }];
  const span = [{ startDate: FROM, endDate: DAY }];
  const out = {};
  // 日ごとの訪問数（ホスト別：shipporitei.jp と yoyaku.shipporitei.jp）
  out.dailyByHost = await run({ dateRanges: span, dimensions: [{ name: "date" }, { name: "hostName" }], metrics: [{ name: "sessions" }, { name: "totalUsers" }], orderBys: [{ dimension: { dimensionName: "date" } }], limit: 200 });
  // その日の流入元（参照元／メディア）
  out.sourceMedium = await run({ dateRanges: day, dimensions: [{ name: "sessionSourceMedium" }, { name: "hostName" }], metrics: [{ name: "sessions" }, { name: "totalUsers" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 40 });
  // 期間全体：日ごと×チャネル（どの流入が増えたか）・入口ページ（どのページから入ったか）（2026-11-07 追加）
  out.channelDaily = await run({ dateRanges: span, dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }], dimensionFilter: { filter: { fieldName: "hostName", stringFilter: { value: "shipporitei.jp" } } }, orderBys: [{ dimension: { dimensionName: "date" } }], limit: 1000 });
  out.landingSpan = await run({ dateRanges: span, dimensions: [{ name: "landingPage" }, { name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }], dimensionFilter: { filter: { fieldName: "hostName", stringFilter: { value: "shipporitei.jp" } } }, orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 80 });
  out.citySpan = await run({ dateRanges: span, dimensions: [{ name: "city" }], metrics: [{ name: "sessions" }], dimensionFilter: { filter: { fieldName: "hostName", stringFilter: { value: "shipporitei.jp" } } }, orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 15 });
  // 比較期間全体の流入元（いつもとの違いを見る）
  out.sourceMediumSpan = await run({ dateRanges: span, dimensions: [{ name: "sessionSourceMedium" }], metrics: [{ name: "sessions" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 30 });
  // その日の入口ページ
  out.landing = await run({ dateRanges: day, dimensions: [{ name: "hostName" }, { name: "landingPage" }], metrics: [{ name: "sessions" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 40 });
  // その日に見られたページ
  out.pages = await run({ dateRanges: day, dimensions: [{ name: "hostName" }, { name: "pagePath" }], metrics: [{ name: "screenPageViews" }, { name: "totalUsers" }], orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }], limit: 40 });
  // 時間帯
  out.hourly = await run({ dateRanges: day, dimensions: [{ name: "hour" }, { name: "hostName" }], metrics: [{ name: "sessions" }], orderBys: [{ dimension: { dimensionName: "hour" } }], limit: 100 });
  // 端末・地域（市区町村）
  out.device = await run({ dateRanges: day, dimensions: [{ name: "deviceCategory" }], metrics: [{ name: "sessions" }] });
  out.city = await run({ dateRanges: day, dimensions: [{ name: "city" }], metrics: [{ name: "sessions" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 15 });
  // その日のイベント（クリックなど）
  out.events = await run({ dateRanges: day, dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }], orderBys: [{ metric: { metricName: "eventCount" }, desc: true }], limit: 30 });
  console.log(JSON.stringify({ day: DAY, from: FROM, ...out }, null, 1));
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
