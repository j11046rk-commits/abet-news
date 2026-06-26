// しっぽり亭 管理ダッシュボード用の GA4 データを取得し site/data/ga4.json を更新する。
// 依存ゼロ（node:crypto でサービスアカウントJWT→トークン→GA4 Data API）。
//
// 認証情報（どちらでも可）:
//   - 環境変数 GA4_PROPERTY_ID と GA4_SA_KEY(鍵JSON文字列) … CI(GitHub Actions secrets)向け
//   - もしくは ~/.config/shippori-report/ga4.env（GA4_PROPERTY_ID / GA4_SA_KEY_PATH）… ローカル向け
//
// 実行: node scripts/fetch-ga4.mjs   （site/ ディレクトリから）

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

// --- レポート定義 ---
const RANGE = { start: "28daysAgo", end: "yesterday" };
const PREV = { start: "56daysAgo", end: "29daysAgo" };
const totalsBody = (s, e) => ({ dateRanges: [{ startDate: s, endDate: e }], metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "screenPageViews" }] });

// HPからのアクション計測。イベント名は Base.astro の click ハンドラと一致させること
// （tel: → tel_click / instagram.com → instagram_click / line.me等 → line_click / 地図 → map_click）。
const ACTION_EVENTS = [
  { event: "line_click", key: "line", label: "公式LINE" },
  { event: "instagram_click", key: "instagram", label: "Instagram" },
  { event: "tel_click", key: "tel", label: "電話（架電）" },
  { event: "map_click", key: "map", label: "地図・経路" },
];

async function main() {
  const { propertyId, sa } = await resolveCreds();
  const token = await getAccessToken(sa);

  const [cur, prev, pages, channels, daily, devices, extra, actions] = await Promise.all([
    runReport(propertyId, token, totalsBody(RANGE.start, RANGE.end)),
    runReport(propertyId, token, totalsBody(PREV.start, PREV.end)),
    runReport(propertyId, token, {
      dateRanges: [{ startDate: RANGE.start, endDate: RANGE.end }],
      dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ desc: true, metric: { metricName: "screenPageViews" } }], limit: 8,
    }),
    runReport(propertyId, token, {
      dateRanges: [{ startDate: RANGE.start, endDate: RANGE.end }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ desc: true, metric: { metricName: "sessions" } }], limit: 6,
    }),
    runReport(propertyId, token, {
      dateRanges: [{ startDate: RANGE.start, endDate: RANGE.end }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "screenPageViews" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    }),
    runReport(propertyId, token, {
      dateRanges: [{ startDate: RANGE.start, endDate: RANGE.end }],
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ desc: true, metric: { metricName: "sessions" } }],
    }),
    runReport(propertyId, token, {
      dateRanges: [{ startDate: RANGE.start, endDate: RANGE.end }],
      metrics: [{ name: "engagementRate" }, { name: "averageSessionDuration" }, { name: "newUsers" }, { name: "screenPageViewsPerSession" }],
    }),
    runReport(propertyId, token, {
      dateRanges: [{ startDate: RANGE.start, endDate: RANGE.end }],
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "sessions" }],
      dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: ACTION_EVENTS.map((a) => a.event) } } },
    }),
  ]);

  const normalizeTotals = (r) => {
    const mv = r?.rows?.[0]?.metricValues ?? [];
    return { sessions: num(mv[0]?.value), users: num(mv[1]?.value), pageviews: num(mv[2]?.value) };
  };
  const totals = normalizeTotals(cur);

  // アクション集計（イベント名→件数・到達セッション）
  const actionMap = {};
  for (const r of actions.rows ?? []) {
    actionMap[r.dimensionValues?.[0]?.value] = {
      count: num(r.metricValues?.[0]?.value),
      sessions: num(r.metricValues?.[1]?.value),
    };
  }
  const totalSessions = Math.max(1, totals.sessions);
  const actionList = ACTION_EVENTS.map((a) => {
    const m = actionMap[a.event] || { count: 0, sessions: 0 };
    return { key: a.key, label: a.label, count: m.count, rate: m.sessions / totalSessions };
  });
  const totalActions = actionList.reduce((s, a) => s + a.count, 0);

  const out = {
    generatedAt: new Date().toISOString(),
    propertyId,
    range: RANGE,
    totals,
    prev: normalizeTotals(prev),
    extra: (() => {
      const ev = extra.rows?.[0]?.metricValues ?? [];
      return {
        engagementRate: num(ev[0]?.value),
        avgSessionDuration: num(ev[1]?.value),
        newUsers: num(ev[2]?.value),
        viewsPerSession: num(ev[3]?.value),
      };
    })(),
    topPages: (pages.rows ?? []).map((r) => ({
      path: r.dimensionValues?.[0]?.value ?? "",
      title: (r.dimensionValues?.[1]?.value ?? "").trim(),
      views: num(r.metricValues?.[0]?.value),
    })),
    channels: (channels.rows ?? []).map((r) => ({ name: r.dimensionValues?.[0]?.value ?? "", sessions: num(r.metricValues?.[0]?.value) })),
    devices: (devices.rows ?? []).map((r) => ({ name: r.dimensionValues?.[0]?.value ?? "", sessions: num(r.metricValues?.[0]?.value) })),
    daily: (daily.rows ?? []).map((r) => ({
      date: r.dimensionValues?.[0]?.value ?? "",
      sessions: num(r.metricValues?.[0]?.value),
      users: num(r.metricValues?.[1]?.value),
      pageviews: num(r.metricValues?.[2]?.value),
    })),
    actions: { items: actionList, total: totalActions },
  };

  const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "ga4.json");
  await writeFile(dest, JSON.stringify(out, null, 2) + "\n");
  console.log(`GA4データ更新: ${dest}`);
  console.log(`  セッション ${totals.sessions} / アクション計 ${totalActions}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
