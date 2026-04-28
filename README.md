# A-BET新聞 自動配信システム

毎朝7:00 JSTにAIニュースを集めて、A-BET新聞PDFを自動生成しLarkに投稿するシステム。

## 構成

```
abet-news/
├── .github/workflows/daily.yml   ← GitHub Actions(毎朝起動)
├── scripts/
│   ├── main.py                   ← メイン実行
│   ├── collect_news.py           ← RSS収集
│   ├── edit_articles.py          ← Anthropic APIで編集
│   ├── render_pdf.py             ← PDF生成
│   └── post_lark.py              ← Lark送信
├── templates/newspaper.html.j2   ← 新聞HTMLテンプレート
├── assets/                       ← ロゴ・アイコン画像
└── requirements.txt
```

## セットアップ手順（iPhoneで完結）

### Step 1: GitHubリポジトリを作る
1. GitHubアプリで右上「+」→「New Repository」
2. Repository name: `abet-news`
3. Private を選択（推奨）
4. Create repository

### Step 2: ファイルをアップロード
このプロジェクト一式（zipで渡す）をリポジトリにアップロード。
GitHubアプリだとファイル単位のアップロードが手間なので、

**おすすめ方法**: Safariで `github.com` にログインし、「Upload files」からzipの中身をドラッグ&ドロップ。
あるいは [GitHub.dev](https://github.dev) を開いて、ブラウザ上のVSCodeでファイルを貼り付ける方が早い。

### Step 3: シークレットを設定
リポジトリの Settings → Secrets and variables → Actions → New repository secret

| Secret名 | 中身 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic APIキー（Arisaさんツールで使ってるやつ） |
| `LARK_WEBHOOK_URL` | LarkのカスタムボットWebhook URL（Step 4で取得） |

PDF添付までやる場合は追加で：

| Secret名 | 中身 |
|---|---|
| `LARK_APP_ID` | Lark Open Platformで作ったアプリのApp ID |
| `LARK_APP_SECRET` | 同App Secret |
| `LARK_CHAT_ID` | 投稿先チャットのID |

### Step 4: Lark側の準備

**簡易版（テキストメッセージのみ・PDFリンクなし）**:
1. Larkで投稿先のグループチャットを開く
2. 設定 → Bots → カスタムボット追加
3. Webhook URLをコピー → GitHubのSecretに `LARK_WEBHOOK_URL` として登録

**完全版（PDFを添付して送信）**:
1. https://open.larksuite.com/app にアクセス
2. アプリを作成（カスタムアプリ）
3. App ID / App Secret をコピー
4. Bot機能をONにし、対象グループに招待
5. 権限: `im:message`, `im:resource` を有効化
6. グループのチャットIDを取得（API経由 or Larkの管理画面）

### Step 5: 動作テスト
1. リポジトリの Actions タブを開く
2. 「Daily A-BET News」を選択
3. 「Run workflow」を押して手動実行
4. 5分ほど待つ
5. 成功すると Larkに通知が来る + PDFがArtifactsからダウンロード可能

### Step 6: 自動運用開始
特に何もしなくても、毎朝7:00 JSTに自動実行される。
止めたい時は `.github/workflows/daily.yml` の `schedule` をコメントアウト。

## カスタマイズ

### 助成金欄を更新する
`scripts/edit_articles.py` の `get_subsidy_topic()` を編集。
将来的にはこれもAIで動的生成可能。

### 取得元RSSを増やす
`scripts/collect_news.py` の `RSS_FEEDS_JP` / `RSS_FEEDS_EN` リストに追加。

### デザインを変える
`templates/newspaper.html.j2` のCSSを編集。

## トラブルシューティング

- **記事が少ない**: RSSフィードが死んでる可能性。`collect_news.py`を直接ローカルで実行してチェック
- **PDFが2ページになる**: テンプレートのフォントサイズを微調整
- **Larkに届かない**: Secretの設定漏れ or Webhook URL期限切れ

## 月額コスト見込み

- GitHub Actions: $0（月2,000分無料枠内）
- Anthropic API: $3〜5（毎日Claude API呼び出し1回）
- ニュース収集: $0（RSS）
- 合計: **月750円〜1,000円程度**
