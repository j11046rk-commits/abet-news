# しっぽり亭 ストーリー告知リマインダー

店長のLINEへ、インスタのストーリー更新依頼を投げるだけのCloudflare Worker。
完了確認も再送もしない（送りっぱなし）。

| いつ | 何を送るか | 休業日は |
|---|---|---|
| 毎週 **月曜 00:30** JST | 定休日告知ストーリーの依頼 ＋ `teikyubi_story.png` | 関係なく毎週送る |
| **営業日 17:45** JST | 開店前・本日のおすすめ告知の依頼 ＋ `osusume_story.png` | 送らない |

「今日は営業日か」は予約システム（`shippori-reserve`）に毎回聞く。
火曜定休も臨時休業も向こうが正なので、このWorkerは曜日を一切持たない。

Instagram Graph APIでの自動投稿は不採用。APIではリンクスタンプ・アンケート・音楽が
使えず、トークン失効の監視も必要になるため、投稿自体は人間がやる形にしてある。

## 構成

```
shippori-story-reminder/
├── src/index.js      ← cronで発火 → 営業日チェック → LINE push
└── wrangler.toml     ← cron 2本（UTC指定）
```

KVもwebhookも使わない。cron triggerとLINE Messaging APIのpushだけ。

---

# セットアップ手順

上から順にやれば終わる。**手順2まで終われば動く**（手順3以降は営業日判定を効かせるため）。

## 手順1: 画像2枚をGitHubに置く

ストーリーに貼る画像を2枚用意する。

| ファイル名 | 用途 |
|---|---|
| `teikyubi_story.png` | 定休日告知（月曜00:30に添付） |
| `osusume_story.png` | おすすめ告知（営業日17:45に添付） |

制約: **HTTPS必須 / JPEGかPNG / 最大10MB**。

1. https://github.com/new で **Public** のリポジトリを作る（例: `shippori-assets`）
   - **必ず Public**。privateだとLINE側から画像を取得できず、画像だけ表示されない
2. 「uploading an existing file」から2枚をアップロード → Commit
3. アップロードした画像を開き、右上の **Raw** ボタンを押してURLをコピーする
   - `https://raw.githubusercontent.com/<ユーザー名>/<リポジトリ名>/main/teikyubi_story.png` の形
4. `src/index.js` の上のほうにある2つの定数を、そのURLに差し替える

```js
const TEIKYUBI_IMAGE_URL = "https://raw.githubusercontent.com/.../teikyubi_story.png";
const OSUSUME_IMAGE_URL  = "https://raw.githubusercontent.com/.../osusume_story.png";
```

> 同じ画像を両方で使いたければ、2つとも同じURLを入れればいい。

## 手順2: Workerをデプロイする

以下はすべてこのディレクトリ（`shippori-story-reminder/`）で実行する。

### 2-1. LINEのトークンと送信先IDを用意する

**アクセス先: https://developers.line.biz/console/**

1. 「しっぽり亭週次レポート」のチャネルを開く
2. **Messaging API設定**タブ → 一番下の「チャネルアクセストークン（長期）」を発行してコピー
   → これが `LINE_CHANNEL_ACCESS_TOKEN`
3. 送信先の `TARGET_ID` を用意する
   - **店長個人に送る場合**: 店長のuserId（`U`で始まる33文字）
   - **グループに送る場合**: groupId（`C`で始まる）
   - IDが分からないときは、同じ画面の「Webhook URL」を使わずとも、
     公式アカウントに一度話しかけてもらい、LINE Developersの
     **Messaging API設定 → あなたのユーザーID** から自分のIDを確認できる。
     店長のIDは、Botに発言してもらってWebhookで取るのが確実。
     まずは自分のIDで動作確認 → 後から `npx wrangler secret put TARGET_ID` で上書き、が早い。

### 2-2. Cloudflareにログインする

```
npx wrangler login
```

ブラウザが開くので、Cloudflareアカウントで承認する。

### 2-3. Secretsを登録する

1つずつ実行して、聞かれたら値を貼り付ける（画面には表示されない）。

```
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put TARGET_ID
npx wrangler secret put TEST_KEY
```

| Secret | 中身 |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | 手順2-1でコピーしたチャネルアクセストークン |
| `TARGET_ID` | 送信先。userId(`U`…) か groupId(`C`…) |
| `TEST_KEY` | `/test-push` を叩くときの合言葉。長めのランダム文字列にする |

`TEST_KEY` は次のコマンドで作れる:

```
openssl rand -hex 32
```

> Secretは登録した時点でCloudflare側に保存される。リポジトリには一切書かない。

### 2-4. デプロイする

```
npx wrangler deploy
```

コンソールにWorkerのURLが出る。形式:

```
https://shippori-story-reminder.<Cloudflareアカウントのサブドメイン>.workers.dev
```

`<サブドメイン>` はアカウントごとに固定。
**アクセス先: https://dash.cloudflare.com/** → Workers & Pages → `shippori-story-reminder` からも確認できる。

**この時点で動く。** ただし営業日判定はまだ効かないので、17:45のリマインドは毎日飛ぶ
（＝火曜にも飛ぶ）。手順3で止める。

## 手順3: 予約システムと繋いで、休業日は送らないようにする

`shippori-reserve` 側に営業日を返す口
（`GET /api/public/business-day`）を追加済み。両者で同じ合言葉を共有する。

### 3-1. 合言葉を作る

```
openssl rand -hex 32
```

出た文字列を控える。**手順3-2と3-3で同じ値を使う。**

### 3-2. 予約システム側に登録する

**アクセス先: https://vercel.com/dashboard**

1. `shippori-reserve` のプロジェクトを開く
2. **Settings → Environment Variables**
3. 追加する:

| Name | Value | Environment |
|---|---|---|
| `BUSINESS_DAY_TOKEN` | 3-1で作った合言葉 | Production |

4. **Deployments** タブ → 最新のデプロイの「…」→ **Redeploy**
   （環境変数は再デプロイしないと反映されない）

### 3-3. Worker側に登録する

このディレクトリで:

```
npx wrangler secret put BUSINESS_DAY_API_URL
npx wrangler secret put BUSINESS_DAY_TOKEN
npx wrangler deploy
```

| Secret | 中身 |
|---|---|
| `BUSINESS_DAY_API_URL` | `https://yoyaku.shipporitei.jp/api/public/business-day`<br>（独自ドメイン未設定なら `https://<プロジェクト名>.vercel.app/api/public/business-day`） |
| `BUSINESS_DAY_TOKEN` | 3-1で作った合言葉（3-2と同じ値） |

### 3-4. 繋がったか確かめる

```
curl -H "x-api-key: <合言葉>" "https://<予約システムのURL>/api/public/business-day?date=2026-08-11"
```

こう返ればOK（2026-08-11は火曜なので `is_closed: true`）:

```json
{"biz_date":"2026-08-11","is_closed":true,"mode":"normal","is_busy":false,
 "event_name":null,"open_min":1080,"close_min":1440}
```

`{"error":"認証できません。"}` が返る場合は合言葉が違うか、手順3-2の再デプロイがまだ。

---

# 動作テスト

cronは `wrangler dev` では発火しない。デプロイ後にブラウザで叩いて確認する。

`https://shippori-story-reminder.<サブドメイン>.workers.dev` を `<Worker>` として:

| 叩くURL | 何が起きるか |
|---|---|
| `<Worker>/test-push?key=<合言葉>` | 定休日告知（月曜00:30と同じもの）を送る |
| `<Worker>/test-push?key=<合言葉>&job=osusume` | おすすめ告知を送る。**今日が休業日なら送らない** |
| `<Worker>/test-push?key=<合言葉>&job=osusume&force=1` | 営業日チェックを飛ばして必ず送る |

返ってくる文字列:

| 表示 | 意味 |
|---|---|
| `pushed: teikyubi` / `pushed: osusume` | LINEに送った |
| `skipped: 2026-08-11 は休業日 (osusume)` | 休業日なので送らなかった（正常） |
| `Error: LINE push failed: 401 …` | トークンが違う／期限切れ |
| `Error: LINE push failed: 400 …` | `TARGET_ID` が違う、または画像URLの形式NG |
| `ok` | 合言葉が違う（`/test-push` として扱われていない） |

**火曜（定休日）に `&job=osusume` を叩いて `skipped` が出れば、営業日判定は効いている。**

ログは https://dash.cloudflare.com/ → Workers & Pages → `shippori-story-reminder` → Logs で見られる。

---

# 運用メモ

- **予約システムが落ちていたら、送る側に倒す。** 営業日判定に失敗したときは
  「営業日扱い」にしてLINEを送る。リマインドが1回余計に飛ぶより、
  店長が告知を忘れるほうが痛いため。ログに理由が残る
- Workersのcronは数分ずれることがある。17:45ちょうどでなくても運用上問題ない
- **臨時休業を反映させるには、予約システムのカレンダーでその日を「休業」にしておく**こと。
  17:45の時点で休業になっていれば送らない
- 文面を変えたい: `src/index.js` の `JOBS` の `text`
- 時刻を変えたい: `wrangler.toml` の `crons`（**UTC指定**。JSTから9時間引く）と、
  `src/index.js` の `JOBS` のキーを**両方**直す。片方だけ直すと
  「未対応のcronです」で落ちる
- LINEの `@ゆうと` はただのテキスト。実際のメンション通知にはならない
- 変更したら毎回 `npx wrangler deploy`
