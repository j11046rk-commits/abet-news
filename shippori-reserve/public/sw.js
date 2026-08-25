/*
 * アプリシェル（HTML/CSS/JS/アイコン）だけをキャッシュして、起動を速くする。
 *
 * 予約データは絶対にキャッシュしない（network-only）。
 * 古い予約表を見せるほうが、少し遅いより遥かに危険だから。
 * オフライン書き込み（あとで同期）も作らない。二重予約の温床になる。
 */
const VERSION = "v3";
const SHELL = `shell-${VERSION}`;

const SHELL_ASSETS = [
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 予約データが乗ってくる経路は素通し。キャッシュに触れさせない。
  if (url.pathname.startsWith("/api/")) return;

  // ビルド成果物とアイコン・ロゴだけ cache-first。
  // ロゴは全画面のヘッダーに出るので、毎回取りに行かせない。
  const isStatic =
    url.pathname.startsWith("/_next/static") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/logo-");
  if (isStatic) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            // 404や5xxを覚えてしまうと、cache-firstゆえ二度と取り直さず
            // その端末だけ壊れたまま固定される。成功した応答だけを覚える。
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL).then((cache) => cache.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // 画面そのものは常にネットワーク。圏外のときだけ1枚出す。
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(
            `<!doctype html><html lang="ja"><meta charset="utf-8">
             <meta name="viewport" content="width=device-width,initial-scale=1">
             <title>オフライン</title>
             <body style="margin:0;display:grid;place-items:center;height:100dvh;
                          background:#111726;color:#eef1f8;
                          font-family:system-ui,sans-serif;text-align:center;padding:2rem">
               <div>
                 <p style="font-size:1.1rem">オフラインです</p>
                 <p style="color:#a9b4c8;font-size:.9rem">
                   電波の良い場所でもう一度開いてください。<br>
                   予約の内容は、最新のものだけをお見せします。
                 </p>
               </div>
             </body></html>`,
            { headers: { "content-type": "text/html; charset=utf-8" } },
          ),
      ),
    );
  }
});
