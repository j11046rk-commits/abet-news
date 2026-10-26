/*
 * 本番ビルドの前に、まだ当てていないマイグレーションを当てる（2026-10-26〜）。
 *
 *   package.json の build から呼ぶ。Vercel の本番ビルドでだけ動き、
 *   手元の npm run build やプレビューでは何もしない。
 *
 * 鉄則「マイグレーション → デプロイ」の順を、人の手順ではなく仕組みで守る。
 * ここが失敗したらビルドごと止める（古い版が本番に残る＝新しいコードが
 * 無い列を読みに行く事故が起きない）。
 *
 * どこまで当てたかは app_migrations に1ファイル1行で記録する。
 * 0058 までは手で当て済みなので、表が空のときはそこまでを当て済みとして記録する。
 *
 * 必要な環境変数（Vercel の Production）:
 *   SUPABASE_ACCESS_TOKEN … Supabase の管理トークン（この予約システムのプロジェクトの Database 書き込みのみ）
 *   NEXT_PUBLIC_SUPABASE_URL … ここからプロジェクトIDを読む
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 手で当て済みの最後の番号。表が空のときだけ使う */
const BASELINE = 58;

const env = process.env;
if (env.VERCEL_ENV !== "production") {
  console.log("[migrate] 本番ビルドではないので何もしません");
  process.exit(0);
}
const token = (env.SUPABASE_ACCESS_TOKEN ?? "").trim();
const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(env.NEXT_PUBLIC_SUPABASE_URL ?? "")?.[1];
if (!token || !ref) {
  console.log("[migrate] SUPABASE_ACCESS_TOKEN か接続先が無いので何もしません");
  process.exit(0);
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

const lit = (s) => `'${s.replaceAll("'", "''")}'`;

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
const files = readdirSync(dir)
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort();

// 記録の表。RLSを有効にして方針を置かない＝アプリの画面やAPIからは見えない
await sql(`create table if not exists public.app_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
alter table public.app_migrations enable row level security;`);

let applied = new Set((await sql("select name from public.app_migrations")).map((r) => r.name));
if (applied.size === 0) {
  const base = files.filter((f) => Number(f.slice(0, 4)) <= BASELINE);
  await sql(`insert into public.app_migrations (name) values ${base.map((f) => `(${lit(f)})`).join(",")}
on conflict do nothing;`);
  applied = new Set(base);
  console.log(`[migrate] 初回：${base.length} 件（〜${String(BASELINE).padStart(4, "0")}）を当て済みとして記録`);
}

const pending = files.filter((f) => !applied.has(f));
if (pending.length === 0) {
  console.log("[migrate] 当てるものはありません");
  process.exit(0);
}

for (const f of pending) {
  const body = readFileSync(join(dir, f), "utf8");
  // 1ファイル＝1トランザクション。途中で失敗したらそのファイルは丸ごと無かったことになる
  try {
    await sql(`begin;\n${body}\n;\ninsert into public.app_migrations (name) values (${lit(f)});\ncommit;`);
  } catch (e) {
    console.error(`[migrate] ${f} の適用に失敗しました。ビルドを止めます。`);
    console.error(String(e));
    process.exit(1);
  }
  console.log(`[migrate] 適用：${f}`);
}
