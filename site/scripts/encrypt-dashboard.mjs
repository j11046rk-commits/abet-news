// ビルド後の dist/dashboard/index.html をパスワードで暗号化（AES-256-GCM）し、
// 「合言葉を入れた人だけ復号して閲覧できる」ゲートページに置き換える。
// 初回に合言葉を入れるとブラウザに記憶し、次回以降は自動で復号して表示（簡単ログイン）。
// 解除は URL に ?logout を付けて開く。
// 依存ゼロ（node:crypto ＋ ブラウザ側は Web Crypto 標準）。
//
// パスワードは環境変数 DASHBOARD_PASSWORD から取得:
//   - CI: GitHubシークレット DASHBOARD_PASSWORD を build ステップに渡す
//   - ローカル: DASHBOARD_PASSWORD=xxxx npm run build
// 未設定なら暗号化せずスキップ（警告のみ）。本番CIでは必ず設定すること。

import { readFile, writeFile } from "node:fs/promises";
import { pbkdf2Sync, randomBytes, createCipheriv } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ITER = 200000;
const target = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "dashboard", "index.html");
const password = process.env.DASHBOARD_PASSWORD;

if (!password) {
  console.warn("⚠️  DASHBOARD_PASSWORD 未設定のため暗号化をスキップ（ダッシュボードは無防備のまま）。本番ビルドでは必ず設定してください。");
  process.exit(0);
}

const html = await readFile(target, "utf8");
if (html.includes("data-staticgate")) {
  console.log("既に暗号化済み。スキップ。");
  process.exit(0);
}

const salt = randomBytes(16);
const iv = randomBytes(12);
const key = pbkdf2Sync(password, salt, ITER, 32, "sha256");
const cipher = createCipheriv("aes-256-gcm", key, iv);
const enc = Buffer.concat([cipher.update(html, "utf8"), cipher.final()]);
const payload = Buffer.concat([enc, cipher.getAuthTag()]); // ciphertext||authTag（WebCrypto形式）
const b64 = (b) => b.toString("base64");

const gate = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<meta name="theme-color" content="#070b16" />
<title>しっぽり亭 ダッシュボード — 認証</title>
<style>
  :root { --g1:#6366f1; --g2:#22d3ee; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; color:#eef2ff;
    font-family:-apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",system-ui,sans-serif;
    background:radial-gradient(800px 500px at 20% -10%,rgba(99,102,241,.2),transparent 60%),
      radial-gradient(700px 500px at 100% 0,rgba(34,211,238,.14),transparent 55%),#070b16; }
  .box { width:min(360px,92vw); background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.1);
    border-radius:18px; padding:30px 26px; backdrop-filter:blur(14px); text-align:center;
    box-shadow:0 20px 60px rgba(0,0,0,.4); }
  .ico { width:46px; height:46px; border-radius:13px; margin:0 auto 16px; display:grid; place-items:center;
    background:linear-gradient(135deg,var(--g1),var(--g2)); box-shadow:0 8px 24px rgba(99,102,241,.5); }
  .ico svg { width:24px; height:24px; stroke:#fff; fill:none; stroke-width:2; }
  h1 { font-size:16px; margin:0 0 4px; font-weight:800; }
  p { font-size:12px; color:#8b93ad; margin:0 0 20px; }
  input { width:100%; padding:12px 14px; border-radius:11px; border:1px solid rgba(255,255,255,.14);
    background:rgba(255,255,255,.05); color:#fff; font-size:15px; outline:none; }
  input:focus { border-color:var(--g2); }
  .remember { display:flex; align-items:center; gap:7px; justify-content:center; margin-top:12px; font-size:12px; color:#8b93ad; }
  .remember input { width:auto; }
  button { width:100%; margin-top:14px; padding:12px; border:0; border-radius:11px; cursor:pointer;
    font-size:14px; font-weight:700; color:#fff; background:linear-gradient(135deg,var(--g1),var(--g2)); }
  button:disabled { opacity:.6; cursor:default; }
  .err { color:#fb7185; font-size:12px; margin-top:12px; min-height:16px; }
  #loading { color:#8b93ad; font-size:13px; letter-spacing:.05em; }
  #f { display:none; }
  .spin { width:26px;height:26px;border-radius:50%;border:3px solid rgba(255,255,255,.15);
    border-top-color:#22d3ee;margin:0 auto 12px;animation:sp .8s linear infinite; }
  @keyframes sp { to { transform:rotate(360deg); } }
</style>
</head>
<body data-staticgate>
  <div id="loading"><div class="spin"></div>読み込み中…</div>
  <form class="box" id="f">
    <div class="ico"><svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></div>
    <h1>アクセス管理ダッシュボード</h1>
    <p>閲覧には合言葉が必要です</p>
    <input id="pw" type="password" autocomplete="current-password" placeholder="パスワード" />
    <label class="remember"><input id="rm" type="checkbox" checked /> このブラウザに記憶する（次回から自動）</label>
    <button id="b" type="submit">表示する</button>
    <div class="err" id="e"></div>
  </form>
<script>
const SALT="${b64(salt)}", IV="${b64(iv)}", DATA="${b64(payload)}", ITER=${ITER}, K="shippori_dash_pw";
const b2u=(s)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const f=document.getElementById('f'), pw=document.getElementById('pw'), e=document.getElementById('e'),
      b=document.getElementById('b'), rm=document.getElementById('rm'), loading=document.getElementById('loading');

async function tryDecrypt(pass){
  try{
    const km=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
    const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b2u(SALT),iterations:ITER,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['decrypt']);
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:b2u(IV)},key,b2u(DATA));
    return new TextDecoder().decode(plain);
  }catch(err){ return null; }
}
function render(html){ document.open(); document.write(html); document.close(); }
function showForm(){ loading.style.display='none'; f.style.display='block'; pw.focus(); }

(async()=>{
  // ?logout で記憶を解除
  if(/[?&]logout\\b/.test(location.search)){ try{localStorage.removeItem(K);}catch(_){} }
  // 記憶済みの合言葉があれば自動ログイン
  let saved=null; try{ saved=localStorage.getItem(K); }catch(_){}
  if(saved){
    const html=await tryDecrypt(saved);
    if(html){ render(html); return; }
    try{ localStorage.removeItem(K); }catch(_){}  // 合言葉変更等で失敗したら記憶を破棄
  }
  showForm();
})();

f.addEventListener('submit',async(ev)=>{
  ev.preventDefault(); e.textContent=''; b.disabled=true; b.textContent='確認中…';
  const html=await tryDecrypt(pw.value);
  if(html){
    if(rm.checked){ try{ localStorage.setItem(K,pw.value); }catch(_){} }
    render(html);
  }else{
    b.disabled=false; b.textContent='表示する'; e.textContent='合言葉が違います'; pw.select();
  }
});
</script>
</body>
</html>
`;

await writeFile(target, gate);
console.log(`🔒 ダッシュボードを暗号化しました（記憶＆自動ログイン対応）: ${target}`);
