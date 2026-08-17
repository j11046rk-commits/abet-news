# 5. 推奨技術スタック と 既存サイトへの組み込み方針

## 1. 結論（先に）

| レイヤ | 採用 | 理由（要点） |
|---|---|---|
| フレームワーク | **Next.js 15（App Router）+ TypeScript** | サーバー側で認証・権限を判定できる。同一プロジェクトでUIとAPIを持てる。**同じリポジトリの `the-oldman/` で既に稼働中＝実績がある** |
| UI | **Tailwind CSS v4** | 設定ファイルが要らず、スマホ実装が速い。`the-oldman/` と同じ |
| DB / 認証 | **Supabase（PostgreSQL + Auth + RLS）**<br>プロジェクト `ytqjgomnktkmoddidypd`・**東京（AWS `ap-northeast-1`）** | 行レベルセキュリティをDBに置ける。ログインID＋パスワード運用が既に確立済み。リージョンは個人情報の所在なので明記する（法28条・確認 2026-08-17） |
| ホスティング | **Vercel（リージョン `hnd1` = 東京）** | Next.jsの標準。`the-oldman/vercel.json` と同じ設定を流用できる |
| PWA | **manifest + Service Worker（自前・軽量）** | ライブラリを増やさない。iOS Safari の挙動は自分で握る |
| 公開フォーム | **既存Astroサイトに静的ページを追加** | 既存のデザイン資産をそのまま使える。サイトの構成を変えずに済む |
| スパム対策 | **Cloudflare Turnstile** | 無料。CAPTCHAの操作が要らない |

**要するに `the-oldman/` と同じ構成をもう一度使う。** 新しいものを試す場面ではない。
運用するのは3名のオーナーと店舗スタッフであって、専任のエンジニアではない。
**すでに動いていて、同じ人が触ったことのある構成であること**が、技術的な新しさより価値がある。

## 2. 「既存サイトに足す」ではダメな理由

現状の `site/` は **Astro の静的サイト（SSG）→ GitHub Pages**。サーバーもDBも無い。

既存の `site/src/pages/dashboard.astro` は、GA4の数字を**ビルド時に暗号化して埋め込み、共通パスワードで復号する**方式。
アクセス解析の数字ならこれで十分だが、**予約管理には使えない**：

| 要件 | 静的＋共通パスワード | 今回必要なもの |
|---|---|---|
| スタッフごとのアカウント | ✗ 全員同じ合言葉 | ✓ 個別アカウント |
| 権限の分離 | ✗ 不可能 | ✓ ロール＋権限 |
| 退職者の締め出し | ✗ パスワード変更＝全員に再周知 | ✓ 1アカウントを無効化 |
| 誰が編集したかの記録 | ✗ 不可能 | ✓ 監査ログ |
| 予約の書き込み | ✗ 静的なので書けない | ✓ 必須 |
| 個人情報（氏名・電話） | ✗ 暗号化済みでも全体が誰でもダウンロード可能 | ✓ 行単位のアクセス制御 |
| リアルタイム性 | ✗ 再ビルドが必要（現状は毎時） | ✓ 即時 |

**予約データはお客様の個人情報**である。ここは妥協できない。
→ **アプリは別プロジェクトとして作る。既存サイトはリンクとフォームで繋ぐ。**

## 3. 既存サイトへの組み込み方針

### リポジトリ：同じリポジトリに並べる（決定）

```
abet-news/
├── site/              ← 既存：しっぽり亭 公式サイト（Astro / GitHub Pages）
├── shippori-reserve/  ← 新規：予約管理アプリ（Next.js / Vercel）★ここ
└── the-oldman/        ← 既存：別店舗の運営ダッシュボード（Next.js / Vercel）
```

`the-oldman/` が既にこの形なので、**リポジトリの作法をそのまま踏襲できる**。
「同じプロジェクト配下に組み込む」という依頼は、この形で満たされる。

### 公開URL：2案。**推奨はA**

| | **A. サブドメイン（推奨）** | B. パス配下 |
|---|---|---|
| URL | `yoyaku.shipporitei.jp` | `shipporitei.jp/yoyaku/` |
| 作業 | DNSに CNAME 1行を足すだけ | **公式サイトのホスティングを GitHub Pages → Vercel へ移設**し、`vercel.json` の rewrites で `/yoyaku/*` を予約アプリへ転送 |
| 既存サイトへの影響 | **ゼロ**（1行も触らない） | 移設作業が必要。DNS切替中にサイトが落ちるリスク |
| 着手までの時間 | 即日 | 移設に数日＋検証 |
| PWA | 問題なし。`yoyaku.shipporitei.jp` 全体がアプリのスコープになり、**むしろ綺麗** | サイト全体と同一オリジン。Service Worker のスコープ設計に注意が必要 |
| Cookie | サブドメインに閉じる（**公開サイト側にセッションCookieが飛ばない＝安全**） | ドメイン共有。設定を誤ると公開ページにCookieが載る |
| SEO | サブドメインごと `noindex`。公開サイトと完全に分離 | `/yoyaku/*` を除外設定する必要がある |
| 費用 | 変化なし | 変化なし |

**推奨は A（`yoyaku.shipporitei.jp`）。**
理由は「稼働中の公式サイトに一切触らずに始められる」こと。公式サイトは集客の本体で、
止めてよいものではない。予約管理を作るために公式サイトを移設する、という順序は
リスクの取り方として逆になっている。

**Bにしたくなったら、後からいつでも移行できる**（Aで運用しつつ、公式サイトをVercelへ移し、
落ち着いてから `/yoyaku/*` の rewrite を張ってリダイレクトする）。**Aは行き止まりではない。**

サブドメイン名の候補：`yoyaku`（分かりやすい）／ `manage` ／ `staff`。**`yoyaku` を推す**。

### 公開サイトとの実際の繋ぎ方（3か所だけ）

1. **予約フォームの追加**：`site/src/pages/reserve.astro` を新規作成。
   既存のデザイン（`global.css` の濃紺×木目、`Icon.astro`）をそのまま使う。
   送信先だけ `https://yoyaku.shipporitei.jp/api/public/reservations`（CORSで `shipporitei.jp` のみ許可）。
2. **既存の予約セクションに導線を1つ足す**：`site/src/components/Reservation.astro` に
   「Webで予約を申し込む」ボタンを追加。電話・LINE・Instagram はそのまま残す
   （**お客様の導線を減らさない**。増やすだけ）。
3. **スタッフ向けリンク**：フッターに小さく `yoyaku.shipporitei.jp` へのリンク。
   ただしiPhoneのホーム画面から起動するのが主なので、必須ではない。

`site/data/site.json` に予約フォームのON/OFFフラグを1つ足しておくと、
準備が整うまで公開せずに済む（既存サイトの流儀＝JSONを直せば変わる、に合わせる）。

## 4. PWA（iPhoneでアプリのように使う）

`the-oldman/` で実際に運用して分かった要点を全部入れる。

### マニフェスト（`src/app/manifest.ts`）

```ts
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "しっぽり亭 予約管理",
    short_name: "しっぽり予約",
    description: "しっぽり亭 店舗予約管理",
    start_url: "/",
    scope: "/",
    display: "standalone",       // ← Safariのアドレスバーを消す
    orientation: "portrait",
    background_color: "#12161F", // 起動スプラッシュの色（公式サイトの濃紺に合わせる）
    theme_color: "#12161F",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
```

### iOS 固有の対応（ここを外すと「アプリっぽく」ならない）

| 項目 | 対応 |
|---|---|
| ホーム画面アイコン | `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">`（180×180・角丸なしの正方形） |
| ステータスバー | `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">` |
| ノッチ／ホームバー | `viewport-fit=cover` ＋ `padding: env(safe-area-inset-top/bottom)`。**`the-oldman` で一度これを忘れてヘッダーがノッチに隠れた**。同じ失敗はしない |
| 画面の高さ | `100vh` ではなく **`100dvh`**（Safariのツールバー分ズレるため） |
| 入力欄の自動ズーム | すべての `input/select/textarea` を **`font-size: 16px` 以上**に |
| プルダウン更新 | `overscroll-behavior-y: contain` でアプリ内スクロールに閉じる |
| タップの遅延・ハイライト | `touch-action: manipulation` / `-webkit-tap-highlight-color: transparent` |
| ログイン維持 | セッションCookieは長め（30日）に。**毎日開くたびにログインさせない** |
| manifest の取得 | ホーム画面追加時、ブラウザがCookie無しで `manifest.webmanifest` を取りに来る。**ミドルウェアの公開パスに含める**（`the-oldman/src/middleware.ts` と同じ対応） |

### Service Worker

- **アプリシェル（HTML/CSS/JS/アイコン）だけをキャッシュ**して、起動を速くする。
- **予約データはキャッシュしない**（network-only）。古い予約表を見せる方が、少し遅いより遥かに危険。
- 圏外時は「オフラインです。電波の良い場所で開いてください」の1枚を出すだけ。
  **オフライン書き込み（後で同期）は作らない**。二重予約の温床になる。
- 更新は `skipWaiting` + `clients.claim()` で、次に開いたときに新しい版になる。

## 5. セキュリティ設定

```jsonc
// shippori-reserve/vercel.json（the-oldman/vercel.json を踏襲）
{
  "framework": "nextjs",
  "regions": ["hnd1"],
  "headers": [{
    "source": "/(.*)",
    "headers": [
      { "key": "X-Robots-Tag",           "value": "noindex, nofollow" },
      { "key": "Referrer-Policy",        "value": "same-origin" },
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "X-Frame-Options",        "value": "DENY" },
      { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains" }
    ]
  }]
}
```

- 未ログインは**全ページ**`/login` へ（ミドルウェア）。加えて**DBのRLSでも拒否**する二重防御。
- `SUPABASE_SERVICE_ROLE_KEY` はサーバー環境変数のみ。クライアントバンドルに入れない。
- 公開APIは Origin 制限＋Turnstile＋レート制限（[04-api.md](04-api.md)）。
- 環境変数一覧（`.env.local.example` として用意する）：

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=       # サーバー専用
AUTH_EMAIL_DOMAIN=shipporitei.local
TURNSTILE_SECRET_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
PUBLIC_FORM_ORIGIN=https://shipporitei.jp
LINE_CHANNEL_SECRET=             # Phase 5
LINE_CHANNEL_ACCESS_TOKEN=       # Phase 5
```

## 6. ランニングコスト

| サービス | プラン | 月額 | 備考 |
|---|---|---|---|
| Supabase | Free | **0円** | 500MBのDB・月5万MAU。**この規模なら当面Freeで足りる**（予約は年間2,000件でも数MB） |
| Supabase | Pro | 約3,900円（$25） | 自動バックアップ7日分・7日以上の無操作でも停止しない。**本番運用ならこちらを推奨** |
| Vercel | Hobby | 0円 | **商用利用は規約上不可**。検証まで |
| Vercel | Pro | 約3,100円（$20） | **店舗の業務利用なので、正規化するならこれ** |
| ドメイン | 既存 `shipporitei.jp` | 0円 | サブドメインを足すだけ |
| Cloudflare Turnstile | Free | 0円 | |
| **合計** | 検証中 | **0円** | Free枠のみ |
| **合計** | 本番（推奨） | **約7,000円/月** | Supabase Pro + Vercel Pro |

**コストを抑える案**：Vercel Pro を避けたい場合、Cloudflare Workers（OpenNext経由）へのデプロイなら
無料枠でも商用利用が可能。ただし構成の実績が `the-oldman` に無いため、**まず Vercel で作り、
必要になったら移す**のが安全。まずはFree枠で作って動かし、運用に乗ってから有料化を判断すればよい。

## 7. 採用しなかった選択肢と理由

| 案 | 却下理由 |
|---|---|
| 既存Astroサイトに直接追加 | 静的サイトでDBも認証も持てない。§2のとおり |
| Googleスプレッドシート＋GAS | 5分で作れるが、権限分離・排他制御・監査ログが無い。二重予約を防げない。スマホでの入力が遅い |
| 市販の予約システム（トレタ・ebica等） | 席割り当ては強力だが、**「日単位で相席イベントに切り替える」「オーナー直通の流入元を分けて集計する」が入らない**。月2〜3万円。この店の運用に合わせる方が安い |
| Supabaseの代わりにFirebase | Firestoreでは「席の時間帯重複を禁止する」制約をDBに書けない。SQLの排他制約が今回の要 |
| Remix / SvelteKit / Nuxt | どれも実現可能だが、`the-oldman` の資産（認証・PWA・レイアウト）を流用できない |
| React Native / Flutter でネイティブアプリ | App Store申請・審査・更新の手間に対して、得られるものが「ホーム画面アイコン」程度。PWAで足りる |
