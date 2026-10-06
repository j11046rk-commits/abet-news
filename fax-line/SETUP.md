# セットアップ手順

上から順に実施する。所要 30〜60 分。既存の Make シナリオは最後まで触らない。

## 0. 先に集めておく値

| 値 | どこで調べるか |
|---|---|
| LINE チャネルアクセストークン | [LINE Developers](https://developers.line.biz/console/) → 対象チャネル → Messaging API 設定 |
| LINE 送信先 ID (グループ ID) | 旧 Make シナリオ `Integration Gmail` の LINE 送信モジュール (#6) の Body にある `to` の値 |
| プリンタのメールアドレス | 旧 Make シナリオ `FAX印刷判定` の Gmail「Send an email」モジュールの宛先 |
| 旧構成が印刷メールを送っていたアカウント | 同じモジュールの Connection 名に出ているメールアドレス |

旧シナリオを開くだけでよい。実行 (Run once) はしないこと。

最後の 1 つは、メール対応プリンタが送信元アドレスを制限している場合に効いてくる。
新構成では Apps Script を動かすアカウント (FAX を受信している Gmail) から印刷メールを
送るため、旧構成の送信元と違っていると印刷だけ弾かれることがある。
違っていた場合は、プリンタ側の許可送信者に新しいアドレスを追加する。

## 1. 画像の保存先 (Cloud Storage)

```bash
PROJECT=fax-relay-koga
BUCKET=${PROJECT}-fax-images

gcloud config set project "$PROJECT"
gcloud storage buckets create "gs://$BUCKET" --location=asia-northeast1 --uniform-bucket-level-access

# LINE のサーバーが画像を取りに来るため、認証なしで読める必要がある。
# objectViewer ではなく legacyObjectReader を使う。前者は objects.list を
# 含むため、バケット名さえ分かれば中身を一覧できてしまう。
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member=allUsers --role=roles/storage.legacyObjectReader

# 7 日で自動削除
cat > /tmp/lifecycle.json <<'JSON'
{"rule":[{"action":{"type":"Delete"},"condition":{"age":7}}]}
JSON
gcloud storage buckets update "gs://$BUCKET" --lifecycle-file=/tmp/lifecycle.json
```

### 保存先について

オブジェクトは認証なしで読める状態になる。LINE がサーバー側から画像を取得する以上
これは避けられない。保護は 3 つ。

- **一覧できないこと** — `legacyObjectReader` は `objects.get` だけを許す。
  `objectViewer` は `objects.list` も含むので使ってはいけない。バケット名は
  推測できるため、一覧を許すとランダムなファイル名の意味が無くなる。
- **ファイル名が推測できないこと** — パスに UUID (128 bit) を挟んでいる。
- **7 日で消えること** — ライフサイクルで自動削除。

これでも足りない場合は署名付き URL (有効期限つき) にする。`main.py` の `_upload` を
`generate_signed_url` (V4、期限は最長 7 日) に差し替え、関数のサービスアカウントに
`roles/iam.serviceAccountTokenCreator` を自分自身に対して付ける。

## 2. 変換関数のデプロイ

```bash
KEY=$(openssl rand -hex 24)   # 控えておく。Apps Script の CONVERTER_API_KEY に使う
echo "$KEY"

cd fax-line/cloud-function
gcloud functions deploy pdf-to-png \
  --gen2 --runtime=python312 --region=asia-northeast1 \
  --source=. --entry-point=convert \
  --trigger-http --allow-unauthenticated \
  --memory=512Mi --timeout=120s \
  --set-env-vars="BUCKET=$BUCKET,API_KEY=$KEY"
```

出力される URL を控える (Apps Script の `CONVERTER_URL`)。

動作確認:

```bash
URL=$(gcloud functions describe pdf-to-png --gen2 --region=asia-northeast1 --format='value(url)')
curl -s -X POST "$URL" -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"pdf_base64\":\"$(base64 -w0 any.pdf)\"}"
```

`{"urls": ["https://storage.googleapis.com/..."], ...}` が返り、その URL を
ブラウザで開いて画像が見えれば成功。

## 3. Drive の保存先フォルダ

Drive に `FAX受信` フォルダを作り、URL の `folders/` 以降の ID を控える。

## 4. Apps Script

1. [script.google.com](https://script.google.com/home) で新規プロジェクトを作る。
   **Gmail を受信しているアカウントで作ること** (スクリプトはその人の権限で Gmail を読む)。
2. `apps-script/Code.gs` の中身を貼り付ける。
3. 歯車アイコン → 「`appsscript.json` マニフェスト ファイルをエディタで表示する」を有効にし、
   `apps-script/appsscript.json` の中身で置き換える。
4. プロジェクトの設定 → スクリプト プロパティに次を登録する。

| プロパティ | 値 |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | 手順 0 で控えたトークン |
| `LINE_TARGET_ID` | 送信先グループ ID |
| `CONVERTER_URL` | 手順 2 の関数 URL |
| `CONVERTER_API_KEY` | 手順 2 の `KEY` |
| `DRIVE_FOLDER_ID` | 手順 3 のフォルダ ID |
| `PRINTER_EMAIL` | プリンタのメールアドレス |
| `WEBHOOK_TOKEN` | `openssl rand -hex 16` などで作った適当な文字列 |

5. エディタで `setup` を選んで実行する。権限の承認を求められるので許可する。
   ラベル `fax-line-sent` と 5 分間隔のトリガーができる。

## 5. 印刷ボタン (LINE webhook)

1. Apps Script で「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」。
   アクセスできるユーザーを **「全員」** にしてデプロイし、URL を控える。
2. その URL の末尾に `?token=` と `WEBHOOK_TOKEN` の値を付けたものを、
   LINE Developers の Webhook URL に設定する。

```
https://script.google.com/macros/s/XXXXXXXX/exec?token=（WEBHOOK_TOKENの値）
```

3. 「Webhook の利用」を ON にする。「検証」は Apps Script が常に 200 を返すため成功する。

### webhook の保護

Apps Script の `doPost` は HTTP ヘッダを読めないため、LINE の `X-Line-Signature` を
検証できない。代わりに URL のクエリに入れたトークンの一致で判定している。
**この URL は署名の代わりなので、そのまま貼って共有しないこと。**

## 6. 切り替え

1. 旧 Make シナリオ `Integration Gmail` と `FAX印刷判定` を **Inactive のままにする**
   (`Integration Gmail` は 2026-10-02 に自動停止済み)。
2. Apps Script のエディタから `checkFax` を手で 1 回実行し、LINE に届くか確認する。
3. 届いたら、次の FAX を待って自動実行でも届くことを確認する。

## 困ったとき

- **LINE に何も来ない** — Apps Script の「実行数」画面でエラーを見る。
- **画像だけ来ない** — 変換関数のログ (Cloud Logging) を見る。
  通知自体は画像化に失敗しても届く作りにしてある。
- **同じ FAX が複数回来る** — 旧 Make シナリオがまだ動いていないか確認する。
- **古い FAX が大量に流れた** — 検索条件が `newer_than:7d` なので 7 日より
  古いものは拾わない。それでも多い場合は `MAX_THREADS_PER_RUN` を下げる。
