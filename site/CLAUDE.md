# CLAUDE.md — しっぽり亭 公式サイト（引き継ぎメモ）

次セッションのAI/開発者向け。サイトの方針・構成・判断理由・TODOをまとめる。
（このファイルは `site/` 配下の公式サイト専用。リポジトリ直下は無関係な別プロジェクト「A-BET新聞」なので触らないこと。）

## 目的（優先順）
1. **法人の宴会幹事に選ばれる** — 個室/収容人数/コース/飲み放題/予算/領収書・請求書/電話予約を即確認できる「ちゃんとした店」感
2. **出張者・来訪者の検索受け皿** — 「新居浜 居酒屋/個室/宴会」での流入
3. 上記を通じた来店増

ターゲットは2人：**A=法人の宴会幹事**、**B=出張中のビジネスパーソン（スマホ検索）**。文言・導線はこの2人基準。

## 技術スタック / 構成判断
- **Astro 6（静的出力）** を採用。理由：データ(JSON)とビューを分離しつつ、ビルド時に静的HTMLへ事前レンダリング → SEO（JSON-LD/メタを初期HTMLに含める）と非エンジニアの編集容易性を両立できるため。
- **コンテンツは `data/site.json` に集約**。全コンポーネントがここを読む。NAP・電話は1か所直せば構造化データまで波及。
- **フォントはJPシステムフォント**（Hiragino/Yu/Noto）でWebフォントDLなし → モバイル表示が速く Lighthouse 有利。外部依存ゼロ。
- 画像は `public/images/` の素朴な `<img loading="lazy">`。理由：JSONの動的パスで差し替える運用と、非エンジニアが「フォルダに置くだけ」で済む手軽さを優先（astro:assetsの静的import縛りを避けた）。実写真は事前圧縮前提（READMEに明記）。
- sitemap は `@astrojs/sitemap`（`sitemap-index.xml`）。robots.txt は `public/` に手書き。
- `site:` は `https://shipporitei.co.jp`（astro.config.mjs）。ドメイン変更時はここ1か所。

## セクション順（src/pages/index.astro）
Header → Hero → Concept → **Banquet(宴会・最重要)** → Menu → Gallery → Access(地図+営業時間) → Reservation → Instagram → Footer ＋ MobileCallBar（スマホ固定の電話/地図バー）。

## 「要確認」の扱い
- `site.json` で値が `"要確認..."` で始まると、画面に**黄色い「要確認」バッジ**が出る（`src/lib/text.js` の `isTBC`）。本人が確定→本文に書き換えれば自動で消える。
- 主な要確認：宴会の収容人数/予算/コース内容/飲み放題/領収書・請求書、看板メニューの価格、駐車場、緯度経度・地図埋め込みURL、昼営業、LINE/フォームURL、OGP写真。

## 確定事項（変えないもの）
- 電話：**0897-47-4494**（正）。**0897-47-6767 は誤りなので使用禁止**。
- 住所：愛媛県新居浜市若水町1-7-2（〒792-0007）。
- 営業：日〜木 18:00〜24:30(LO24:00) / 金土 18:00〜25:00(LO24:30)、定休なし。
- 情報の正は **Instagram @shipporitei**。他媒体と矛盾したらIG優先。

## SEO実装済み
- `<title>`/description に「新居浜 居酒屋/個室/宴会/コース」を自然に内包
- JSON-LD `Restaurant`（住所/電話/営業時間/価格帯/geo/menu/sameAs=IG）
- OGP/Twitterカード、canonical、favicon、apple-touch-icon、sitemap、robots
- 画像alt、h1→h2階層、lazy-load、`theme-color`

## TODO（本人作業／次セッション候補）
- [ ] `data/site.json` の「要確認」を全部埋める（特に**宴会セクション＝稟議材料**）
- [ ] 写真差し替え（特に**個室・席**の写真。OGPも実写真に）
- [ ] 緯度経度・Googleマップ埋め込みURLを実店舗ピンに（`店舗情報`）
- [ ] Instagram自動フィードのウィジェット設定（`src/components/Instagram.astro` の `embedHtml`）
- [ ] Cloudflare Pages 接続（Root directory=`site`）＋ 独自ドメイン shipporitei.co.jp 接続（READMEのDNS手順）
- [ ] Googleビジネスプロフィールと NAP を一字一句そろえる
- [ ] 公開後：Search Console 登録・sitemap送信、PageSpeed/Lighthouse 実測

## 改善余地（任意）
- 実写真導入後、`astro:assets` で WebP 自動最適化に切替を検討（運用容易性とのトレードオフ）
- メニューが増えるなら `看板メニュー` を content collection 化
- 構造化データに `Menu`/`MenuItem`、`aggregateRating`（レビュー導入時）を追加
