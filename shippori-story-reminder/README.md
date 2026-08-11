# しっぽり亭 定休日ストーリー告知リマインダー

毎週月曜 00:30 JST に、店長のLINEへ「インスタストーリーの定休日告知をお願いします」
というテキストと画像を自動送信するだけのCloudflare Worker。
完了確認も再送もしない（送りっぱなし）。

Instagram Graph APIでの自動投稿は不採用。APIではリンクスタンプ・アンケート・音楽が
使えず、トークン失効の監視も必要になるため、投稿自体は人間がやる形にしてある。

## 構成

```
shippori-story-reminder/
├── src/index.js      ← cronで発火 → LINE push
└── wrangler.toml     ← cron設定（日曜15:30 UTC = 月曜00:30 JST）
```

KVもwebhookも使わない。cron triggerとLINE Messaging APIのpushだけ。

## セットアップ

以下はすべてこのディレクトリ（`shippori-story-reminder/`）で実行する。

### 1. Cloudflareにログイン

```
npx wrangler login
```

### 2. Secretsを登録（値は対話で入力する）

```
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put TARGET_ID
npx wrangler secret put TEST_KEY
```

| Secret | 中身 |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | 「しっぽり亭週次レポート」LINE公式アカウントのMessaging APIチャネルアクセストークン（LINE Developers → 該当チャネル → Messaging API設定） |
| `TARGET_ID` | 送信先。個人なら userId（`U`始まり）、グループなら groupId（`C`始まり） |
| `TEST_KEY` | `/test-push` を叩くときの合言葉。任意の文字列でいい |

> Secretは `wrangler secret put` で登録した時点でCloudflare側に保存される。
> リポジトリには一切書かない。

### 3. デプロイ

```
npx wrangler deploy
```

デプロイ後、コンソールに Worker のURLが出る。形式は:

```
https://shippori-story-reminder.<Cloudflareアカウントのサブドメイン>.workers.dev
```

`<サブドメイン>` はCloudflareアカウントごとに固定の文字列。
Cloudflareダッシュボード → Workers & Pages → 該当Worker からも確認できる。

### 4. 動作テスト

cronは `wrangler dev` では発火しないので、デプロイ後にブラウザで叩いて確認する。

```
https://shippori-story-reminder.<サブドメイン>.workers.dev/test-push?key=<TEST_KEY>
```

- `pushed` と表示されればLINEに届いている
- 失敗するとLINE APIのエラー本文がそのまま出るので、それを見て切り分ける
- それ以外のパスは常に `ok` を返すだけ

## 画像の差し替え

`src/index.js` の `IMAGE_URL` はプレースホルダのまま。
`teikyubi_story.png` を **publicな** GitHubリポジトリに置いてから、raw URLに差し替えて再デプロイする。

```js
const IMAGE_URL =
  "https://raw.githubusercontent.com/<ユーザー名>/<リポジトリ名>/main/teikyubi_story.png";
```

制約:

- HTTPS必須
- JPEG または PNG
- 最大10MB
- privateリポジトリのraw URLはLINE側から取得できないので、必ずpublicに置く

差し替えたら `npx wrangler deploy` をもう一度実行。

## 注意点

- Workersのcronは数分ずれることがある。00:30ちょうどでなくても運用上問題ない
- 送信スケジュールを変えたい場合は `wrangler.toml` の `crons` を編集する（**UTC指定**）
- 文面を変えたい場合は `src/index.js` の `MESSAGE_TEXT`
- LINEの `@ゆうと` はただのテキスト。実際のメンション通知にはならない
