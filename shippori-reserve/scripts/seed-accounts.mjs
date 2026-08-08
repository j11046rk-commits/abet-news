/**
 * 初期アカウント9名を発行する。
 *
 *   node scripts/seed-accounts.mjs
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

const MEMBERS = [
  { login_id: "koga", display_name: "古賀 龍馬", role: "owner", is_owner_contact: true, sort_order: 10 },
  { login_id: "yamamoto", display_name: "山本 善洋", role: "owner", is_owner_contact: true, sort_order: 20 },
  { login_id: "oka", display_name: "岡 宣行", role: "owner", is_owner_contact: true, sort_order: 30 },
  { login_id: "watanabe", display_name: "渡邊 祐人", role: "manager", is_owner_contact: false, sort_order: 40 },
  { login_id: "ando", display_name: "安藤 正", role: "staff", is_owner_contact: false, sort_order: 50 },
  { login_id: "kanemoto", display_name: "金本 絵美", role: "staff", is_owner_contact: false, sort_order: 60 },
  { login_id: "yasui", display_name: "安井 琉惺", role: "staff", is_owner_contact: false, sort_order: 70 },
  { login_id: "takagi", display_name: "高木 雅也", role: "staff", is_owner_contact: false, sort_order: 80 },
  { login_id: "shiraishi", display_name: "白石 湧駕", role: "staff", is_owner_contact: false, sort_order: 90 },
];

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
