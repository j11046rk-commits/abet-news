# FAX → LINE 通知

複合機で受信した FAX を LINE に流し、「印刷する」ボタンで紙に出すまでを行う。

## 構成

```
複合機 ──(メール転送)──> Gmail ──> Apps Script ──> LINE
                                      │   ↑
                              PDF 保管 │   │ 画像化
                                      ↓   │
                                 Drive    Cloud Functions (pdf-to-png)
```

| 部品 | 役割 |
|---|---|
| Gmail | 複合機が転送してくる FAX 受信メール (本文に `RJOBNUM=` 等、PDF 添付) |
| Apps Script | 5 分おきに未処理メールを拾い、Drive 保管 → 画像化 → LINE 送信。`印刷する` の postback も受ける |
| Drive | FAX の PDF 原本。印刷時にここから取り出す |
| Cloud Functions | PDF を PNG にする (`fax-line/cloud-function`)。LINE は PDF を直接表示できないため |
| LINE | 通知先のグループ |

セットアップ手順は [SETUP.md](SETUP.md)。

## 旧構成からの変更 (2026-10)

以前は `複合機 → Gmail → Apps Script → Make → pdf.co → Cloud Functions → OneDrive → LINE`
の 8 部品だった。Make・pdf.co・OneDrive を外して 4 部品にしたのがこの実装。

変更の理由は下の障害履歴のとおりで、**2 回とも外部サービスの無料枠切れで全体が止まった**。
部品が減った分、止まる箇所と、止まったときに探す場所が減る。

重複投稿も作りの上で解消している。旧構成では「どこまで処理したか」の管理が
Apps Script と Make に分かれていて、同じ FAX が最大 9 回処理されていた。
いまは Apps Script が `LockService` と Gmail ラベルと送信済みの印の 3 つで
1 通のメールを 1 回しか処理しないようにしている。

## 障害履歴

| 日付 | 症状 | 原因 |
|---|---|---|
| 2026-08-10 | 画像が届かない・同じ FAX が重複 | Google Cloud の無料トライアル終了で課金が無効化。`auto-orient-image` が全滅し、失敗 → 再送 → 重複 |
| 2026-10-02 | 通知が完全に停止 | pdf.co のトライアルクレジット枯渇 (402 Not enough credits)。Make がシナリオを自動停止 |

どちらも原因の特定に時間がかかった。Make の設定は画面の中にしか無く、
外から読めなかったことが大きい。コードにしたのはそれも理由。

## 無料枠 (ここが切れると止まる)

| サービス | 枠 | 想定使用量 |
|---|---|---|
| Apps Script | 無料・無期限。UrlFetch は 1 日 20,000 回 | FAX 1 件あたり 3 回 |
| Cloud Run (関数) | 月 200 万リクエスト | FAX 1 件あたり 1 回 |
| Cloud Storage | 5 GB (Always Free, us リージョン) | 7 日で自動削除する運用 |
| Drive | Google アカウントの 15 GB を共用 | PDF 1 件 数百 KB |
| LINE Messaging API | 無料枠は月 200 通 (2026 年時点のフリープラン) | FAX 1 件あたり 1〜5 通 |

**LINE の月 200 通が実際には一番きつい。** 1 件の FAX で Flex 1 通 + 画像ページ数分を
送るため、ページ数が多いと消費が早い。`MAX_IMAGES` を減らすと節約できる。
