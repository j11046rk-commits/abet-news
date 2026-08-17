/**
 * 初期アカウントを発行する。
 *
 *   node scripts/seed-accounts.mjs
 *
 * 名簿は scripts/members.json（gitに入れない）から読む。
 * 形は scripts/members.example.json と同じ。
 *
 * ★名簿をこのファイルに書かないこと。
 *   もともとスタッフ9名の本名がここに直接書かれていて、リポジトリに
 *   入っていた。アカウントを作るのは最初の1回だけなのに、氏名は
 *   コードとして残り、履歴からも消えない。名簿は名簿として外に置く。
 *
 * .env.local の NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / AUTH_EMAIL_DOMAIN を読む。
 * 初期パスワードは実行時にランダム生成し、**この標準出力にだけ**出る。
 * 表を印刷するなり画面を控えるなりして、本人に口頭で渡してください。
 * 全員 must_change_password = true なので、初回ログインで必ず変更させられます。
 *
 * 既に存在するログインIDは飛ばすので、追加の1名だけ流したいときも同じコマンドでよい。
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// .env.local を読む（dotenv を足さずに済ませる）
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  // 環境変数が既に入っているならファイルは要らない
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DOMAIN = process.env.AUTH_EMAIL_DOMAIN ?? "shipporitei.local";

if (!URL_ || !KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。");
  process.exit(1);
}

const MEMBERS = (() => {
  const path = new URL("./members.json", import.meta.url);
  try {
    const list = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(list) || list.length === 0) throw new Error("empty");
    for (const m of list) {
      if (!m?.login_id || !m?.display_name || !m?.role) {
        throw new Error(`login_id / display_name / role が足りない行があります: ${JSON.stringify(m)}`);
      }
    }
    return list.map((m, i) => ({
      is_owner_contact: false,
      sort_order: (i + 1) * 10,
      ...m,
    }));
  } catch (e) {
    console.error("scripts/members.json が読めませんでした:", e.message);
    console.error("scripts/members.example.json をコピーして名簿を書いてください（gitには入りません）。");
    process.exit(1);
  }
})();

/** 口頭で読み上げる前提なので、紛らわしい文字（l/1/O/0）を除く */
function password(length = 12) {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const admin = createClient(URL_, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const issued = [];

for (const m of MEMBERS) {
  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("login_id", m.login_id)
    .maybeSingle();

  if (existing) {
    console.log(`skip  ${m.login_id.padEnd(10)} 既に存在します`);
    continue;
  }

  const pw = password();
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: `${m.login_id}@${DOMAIN}`,
    password: pw,
    email_confirm: true,
  });

  if (authError || !created?.user) {
    console.error(`FAIL  ${m.login_id.padEnd(10)} ${authError?.message ?? "不明なエラー"}`);
    continue;
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    login_id: m.login_id,
    display_name: m.display_name,
    role: m.role,
    is_owner_contact: m.is_owner_contact,
    sort_order: m.sort_order,
    must_change_password: true,
  });

  if (profileError) {
    // auth 側だけ残ると次回の実行で衝突するので、必ず巻き戻す
    await admin.auth.admin.deleteUser(created.user.id);
    console.error(`FAIL  ${m.login_id.padEnd(10)} ${profileError.message}`);
    continue;
  }

  issued.push({ ...m, password: pw });
  console.log(`ok    ${m.login_id.padEnd(10)} ${m.display_name}`);
}

if (issued.length > 0) {
  console.log("\n──────── 初期パスワード（この表示が唯一の控えです）────────");
  for (const i of issued) {
    console.log(`${i.login_id.padEnd(10)} ${i.display_name.padEnd(12)} ${i.password}`);
  }
  console.log("───────────────────────────────────────────────────────────");
  console.log("本人に口頭で渡してください。初回ログイン時に本人が変更します。");
}
