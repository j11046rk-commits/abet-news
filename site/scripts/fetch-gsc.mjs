// Google Search Console から「何と検索されてHPに来たか」を取り、data/gsc.json に書く（2026-11-07・店主要望）。
// アクセス増の要因分析で「店名で探されたのか、忘年会などの言葉で見つけられたのか」が GA4 では分からなかったため。
//
// 鍵は GA4 と同じサービスアカウント（GA4_SA_KEY）を使う。Search Console 側で、そのサービスアカウントの
// メールアドレスを「ユーザー（制限付き）」に追加すると読めるようになる。追加前は status: "unconnected" と
// メールアドレスだけを書く（ダッシュボードが手順を出す）。鍵そのものは書かない・ログに出さない。
//
// 失敗してもビルドは止めない（呼び出し側で || echo）。前回のデータは残す。
import { readFile, writeFile } from "node:fs/promises";
import { createSign } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/webmasters/v3";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const DEST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "gsc.json");
const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** 店名で探した検索か（ひらがな・カタカナ・ローマ字・空白の揺れを吸収） */
export function isBrandQuery(q) {
  const t = String(q).normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  return /しっぽり|シッポリ|shippori|sippori|しっぽりてい/.test(t);
}

/**
 * ページの表記をそろえる。ドメイン型のプロパティは予約サイト（yoyaku.）も含むので、HP本体以外はホスト名を残す。
 * ?fbclid= などの計測用の付け足しは外して、同じページとしてまとめる。
 */
export function pageLabel(url) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname || "/";
  return host === "shipporitei.jp" ? path : `${host.replace(/\.shipporitei\.jp$/, "")}：${path}`;
}
function mergePages(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = pageLabel(r.keys[0]);
    const o = m.get(k) ?? { page: k, clicks: 0, impressions: 0, posSum: 0 };
    o.clicks += r.clicks;
    o.impressions += r.impressions;
    o.posSum += r.position * r.impressions;
    m.set(k, o);
  }
  return [...m.values()]
    .map((o) => ({ page: o.page, clicks: o.clicks, impressions: o.impressions, position: o.impressions ? Math.round((o.posSum / o.impressions) * 10) / 10 : 0 }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 12);
}

const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

async function token(sa) {
  const iat = Math.floor(Date.now() / 1000);
  const input = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_ENDPOINT, iat, exp: iat + 3600 }))}`;
  const sig = createSign("RSA-SHA256").update(input).sign(sa.private_key);
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${input}.${b64url(sig)}` }).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`トークン取得失敗: ${res.status}`);
  return json.access_token;
}

async function api(tk, pathname, body) {
  const res = await fetch(`${API}${pathname}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${tk}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Search Console ${res.status}: ${json?.error?.message ?? ""}`);
  return json;
}

/** まだ読めない理由を、ダッシュボードが手順を出せる形で書く（前回のデータが「ok」なら上書きしない） */
async function writeUnconnected(sa, reason, enableUrl = null) {
  try {
    const prev = JSON.parse(await readFile(DEST, "utf8"));
    if (prev.status === "ok" && reason === "error") return; // 一時的な失敗で前回の数字を消さない
  } catch { /* 初回 */ }
  await writeFile(DEST, JSON.stringify({ status: "unconnected", reason, enableUrl, serviceAccount: sa.client_email, checkedAt: new Date().toISOString() }, null, 2) + "\n");
}

async function main() {
  if (!process.env.GA4_SA_KEY) throw new Error("GA4_SA_KEY 未設定（ローカル実行ではスキップ）");
  const sa = JSON.parse(process.env.GA4_SA_KEY);
  const tk = await token(sa);

  // サービスアカウントが見られるプロパティから shipporitei.jp を探す（ドメイン型を優先）
  let sites;
  try {
    sites = (await api(tk, "/sites")).siteEntry ?? [];
  } catch (e) {
    // Google Cloud 側で Search Console API が有効になっていない（GA4用に作ったプロジェクトでは最初は無効）
    const msg = String(e.message || e);
    const url = msg.match(/https:\/\/console\.developers\.google\.com\/apis\/api\/searchconsole\.googleapis\.com\/overview\?project=\d+/)?.[0] ?? null;
    await writeUnconnected(sa, /has not been used|is disabled/.test(msg) ? "api_disabled" : "error", url);
    throw e;
  }
  const pick =
    sites.find((s) => s.siteUrl === "sc-domain:shipporitei.jp") ??
    sites.find((s) => /^https?:\/\/(www\.)?shipporitei\.jp\/?$/.test(s.siteUrl));
  if (!pick) {
    await writeUnconnected(sa, "not_shared");
    console.log("Search Console：まだ共有されていません（サービスアカウントをユーザーに追加すると読めます）");
    return;
  }

  // 検索のデータは2〜3日遅れて確定するので、3日前までの28日間と、その前の28日間
  const end = daysAgo(3), start = daysAgo(30), pEnd = daysAgo(31), pStart = daysAgo(58);
  const site = encodeURIComponent(pick.siteUrl);
  const q = (startDate, endDate, dimensions, rowLimit = 250) =>
    api(tk, `/sites/${site}/searchAnalytics/query`, { startDate: ymd(startDate), endDate: ymd(endDate), dimensions, rowLimit, dataState: "final" }).then((r) => r.rows ?? []);

  const [tot, ptot, queries, pqueries, pages] = await Promise.all([
    q(start, end, []),
    q(pStart, pEnd, []),
    q(start, end, ["query"]),
    q(pStart, pEnd, ["query"]),
    q(start, end, ["page"], 50),
  ]);
  const sum = (rows) => {
    const r = rows[0] ?? { clicks: 0, impressions: 0, position: 0 };
    return { clicks: r.clicks, impressions: r.impressions, position: Math.round((r.position ?? 0) * 10) / 10 };
  };
  const split = (rows) => {
    const o = { brand: { clicks: 0, impressions: 0 }, other: { clicks: 0, impressions: 0 } };
    for (const r of rows) {
      const k = isBrandQuery(r.keys[0]) ? "brand" : "other";
      o[k].clicks += r.clicks;
      o[k].impressions += r.impressions;
    }
    return o;
  };
  const prevBy = new Map(pqueries.map((r) => [r.keys[0], r.clicks]));
  const out = {
    status: "ok",
    site: pick.siteUrl,
    generatedAt: new Date().toISOString(),
    range: { start: ymd(start), end: ymd(end) },
    prevRange: { start: ymd(pStart), end: ymd(pEnd) },
    totals: sum(tot),
    prev: sum(ptot),
    split: split(queries),
    prevSplit: split(pqueries),
    queries: queries
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
      .slice(0, 20)
      .map((r) => ({
        query: r.keys[0],
        brand: isBrandQuery(r.keys[0]),
        clicks: r.clicks,
        impressions: r.impressions,
        position: Math.round(r.position * 10) / 10,
        prevClicks: prevBy.get(r.keys[0]) ?? 0,
      })),
    pages: mergePages(pages),
  };
  await writeFile(DEST, JSON.stringify(out, null, 2) + "\n");
  console.log(`Search Console：${out.totals.clicks}クリック / ${out.totals.impressions}表示（${out.range.start}〜${out.range.end}）`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (e) => {
    console.error(`Search Console 取得失敗：${String(e.message || e)}`);
    process.exit(1);
  });
}
