# しっぽり亭 公式サイト

新居浜の居酒屋「しっぽり亭」の公式サイト（1ページ完結のLP）。
Astro で作った静的サイトです。ビルドすると `dist/` に書き出され、Cloudflare Pages に公開できます。

- テーマ: ダーク × 暖色・和モダン（大人の隠れ家）／スマホ最優先
- 公開URL（正）: https://shipporitei.co.jp/

---

## ✏️ いちばん大事：文言・メニューの差し替え方法

**`data/site.json` の1ファイルだけ**を編集すれば、サイトの文章・メニュー・営業時間・電話番号などが差し替わります。
エンジニアでなくても編集できます。

### ルール
- **値（`:` の右側、`"..."` の中身）だけ**を書き換える
- キー（`:` の左側）や記号（`{ } [ ] , "`）は消さない
- `"要確認..."` と書かれている所は、**店主が後で確定する箇所**です（サイト上でも黄色い「要確認」バッジで目立つようになっています）。確定したら本文に書き換えてください
- `_` で始まるキー（`_README` `_注意` など）は**画面に出ないメモ**です。編集の手がかりにしてOK

### 例：電話番号を直す
```json
"電話番号": "0897-47-4494",
"電話番号表示用": "0897-47-4494",
```
この2か所を直すと、ヘッダー・ヒーロー・予約・フッター・地図・**構造化データ（Google検索用）**まで一括で変わります。

### 編集できる主な項目
| 項目 | 場所（site.json 内） |
|---|---|
| 店名・住所・電話・キャッチコピー | `店舗情報` |
| アクセス・駐車場 | `アクセス` |
| 営業時間・定休日 | `営業時間` |
| 宴会・コース（最重要） | `宴会コース` |
| 看板メニュー（名前・価格・説明） | `看板メニュー` |
| ギャラリーの写真とaltテキスト | `ギャラリー` |
| LINE・問い合わせフォームのURL | `予約問い合わせ` |
| Instagram | `instagram` |
| 検索結果のタイトル・説明文 | `seo` |

> **情報の「正」は Instagram（@shipporitei）に合わせること。** Yahoo!マップ・食べログ等は古い場合があります。食い違ったら IG 優先で `site.json` を更新してください。

---

## 🖼 写真の差し替え方法

いまは仮のプレースホルダー画像が入っています。実際の写真に差し替えるには：

1. 写真を用意（**スマホ写真でOK。事前に少し圧縮**すると表示が速くなります。例: [squoosh.app](https://squoosh.app/) で幅1200px・JPG/WebP）
2. `public/images/` フォルダに置く（例: `menu-01.jpg`）
3. `data/site.json` の該当する `"画像"` のパスと `"alt"` を直す
   ```json
   { "名前": "海鮮丼（エビ・まぐろ）", "価格": "1200", "画像": "/images/menu-02.jpg", "alt": "エビとまぐろの海鮮丼" }
   ```
   - パスは必ず `/images/...` で始める
   - `alt` は写真の内容を日本語で（**SEOと読み上げのため必須**）

差し替え対象（プレースホルダー一覧）:
- `menu-01〜04`（看板メニュー）
- `gallery-01〜06`（店内・個室・料理。**個室や席の写真を必ず入れる**＝幹事の不安を消す）
- `ogp.png`（SNSシェア画像・1200×630推奨。店の写真＋店名にすると見栄えUP）
- `apple-touch-icon.png` / `favicon.svg`（アイコン）

> プレースホルダーを作り直したいときは `node scripts/gen-placeholders.mjs` を実行。

---

## 💻 ローカルで動かす

事前に [Node.js](https://nodejs.org/)（18以上）が必要です。

```bash
cd site
npm install          # 最初の1回だけ
npm run dev          # http://localhost:4321 で表示・編集すると即反映
```

公開用にビルドする：
```bash
npm run build        # dist/ に書き出し
npm run preview      # ビルド結果を確認
```

---

## ☁️ Cloudflare Pages へのデプロイ

### A. サイトを公開する（GitHub連携・推奨）
1. Cloudflare ダッシュボード → **Workers & Pages → Create → Pages → Connect to Git**
2. このリポジトリを選択
3. ビルド設定を以下にする：
   | 項目 | 値 |
   |---|---|
   | Production branch | `main`（公開したいブランチ） |
   | Framework preset | Astro |
   | **Root directory** | `site` ← このサイトはサブフォルダにあるので必須 |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
4. Save and Deploy → `*.pages.dev` のURLで公開される

> Root directory を `site` にし忘れると失敗します（リポジトリ直下は別プロジェクトのため）。

### B. 独自ドメイン shipporitei.co.jp を接続する

`.co.jp` は **お名前.com / Xserver 等の日本のレジストラで取得**します（Cloudflare では .co.jp を買えません）。取得後、DNSで Pages に向けます。**やり方は2通り**、どちらでもOK：

#### 方法①：DNSレコードだけ向ける（移管不要・手軽）
1. Cloudflare Pages のプロジェクト → **Custom domains → Set up a domain** に `shipporitei.co.jp` と `www.shipporitei.co.jp` を追加
2. Cloudflare が表示する宛先に合わせ、**レジストラの管理画面でDNSレコードを設定**：
   - ルート `shipporitei.co.jp` → **CNAME**（フラット化対応なら）または案内された **A/AAAA レコード**を `<プロジェクト>.pages.dev` 宛に
   - `www` → **CNAME** `<プロジェクト>.pages.dev`
3. 反映まで数分〜最大48時間。SSL証明書は Cloudflare が自動発行

#### 方法②：ネームサーバごとCloudflareへ移管（管理を一元化したい場合）
1. Cloudflare で **Websites → Add a site** に `shipporitei.co.jp` を追加（DNSプラン無料でOK）
2. Cloudflare が割り当てる2つのネームサーバ（例 `xxx.ns.cloudflare.com`）を、**レジストラ側のネームサーバ設定に登録**
3. 反映後、Pages の Custom domains にドメインを追加すると自動でDNSが設定される

> どちらでも結果は同じ（https://shipporitei.co.jp/ で表示）。**①は手軽、②は今後の管理が楽**。
> 構造化データ・OGP・sitemap は最初から `https://shipporitei.co.jp/` 前提で作ってあるので、**接続後はそのまま正しく動きます**。
> ドメインを変える場合だけ `astro.config.mjs` の `site:` を直してください。

---

## 📷 Instagram の最新投稿フィードを有効化する

IG はトークンなしの公開埋め込みを廃止したため、**無料ウィジェット**を使うのが簡単・無保守です。

1. 無料サービスでアカウント作成（例: [Behold](https://behold.so/) / [SnapWidget](https://snapwidget.com/) / [EmbedSocial](https://embedsocial.com/)）
2. `@shipporitei` を接続し、**埋め込みコード（`<script>` か `<iframe>`）** をコピー
3. `src/components/Instagram.astro` の先頭にある `const embedHtml = '';` に、そのコードを貼る
   ```js
   const embedHtml = `<script src="https://snapwidget.com/..."></script>`;
   ```
4. `npm run build` して再デプロイ

> 設定するまではプロフィール誘導（フォローボタン＋プレースホルダー）が表示されます。
> ウィジェットを使えば、店主がIGを更新するだけでHPのフィードも勝手に新鮮に保たれます。

---

## 構成

```
site/
├── data/site.json          ← ★ 文言・メニューはここを編集
├── public/                 ← 画像・favicon・robots.txt（そのまま配信される）
│   ├── images/             ← 写真の差し替え先
│   ├── favicon.svg
│   ├── apple-touch-icon.png
│   └── robots.txt
├── src/
│   ├── layouts/Base.astro  ← <head>・OGP・構造化データ(JSON-LD)
│   ├── components/         ← 各セクション
│   ├── pages/index.astro   ← セクションの並び順
│   └── styles/global.css   ← 色・フォント・共通スタイル
├── scripts/gen-placeholders.mjs
├── astro.config.mjs        ← site URL / sitemap 設定
└── package.json
```

詳しい方針・今後のTODOは `CLAUDE.md` を参照。
