# 4. API設計

## 4-0. 方針

- ベースURL：`https://yoyaku.shipporitei.jp/api`（[05-stack.md §3](05-stack.md#3-既存サイトへの組み込み方針) の決定次第）
- 認証：**HttpOnly Cookie セッション**（Supabase Auth / SSR）。ヘッダにトークンを持ち回らない。
- 形式：JSON（`Content-Type: application/json`）。日時は ISO 8601（`2026-08-07T18:00:00+09:00`）、営業日は `YYYY-MM-DD`。
- **画面内の操作は Next.js の Server Actions を第一に使う**（往復が減り、型が繋がる）。
  ここに書く REST エンドポイントは
  ①外部連携（公開フォーム・Webhook）、②将来の別クライアント、③動作確認のために**併設**する。
  どちらも同じドメインロジック（`src/lib/`）を呼ぶので、判定が二重化することはない。
- すべての書き込みAPIは**サーバー側で権限を再チェック**する（UIで隠すのは親切であって、防御ではない）。

### 共通エラー形式

```json
{ "error": { "code": "RULE_DENIED", "message": "金・土は2名様を6名席へお通ししない運用です。", "details": { "rule_id": "…" } } }
```

| HTTP | code | 意味 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | 入力不備（`details.fields` に項目名） |
| 401 | `UNAUTHENTICATED` | 未ログイン |
| 403 | `FORBIDDEN` | 権限不足 |
| 404 | `NOT_FOUND` | 対象なし |
| 409 | `SEAT_CONFLICT` | その席・その時間は既に埋まっている |
| 409 | `CAPACITY_EXCEEDED` | イベント営業日の定員超過 |
| 422 | `RULE_DENIED` | 席ルールが原則NG。`override_reason` があれば通る |
| 429 | `RATE_LIMITED` | レート制限（公開API） |

---

## 4-1. エンドポイント一覧

### 認証

| Method | パス | 権限 | 概要 |
|---|---|---|---|
| POST | `/api/auth/login` | — | ログインID＋パスワード → セッションCookie |
| POST | `/api/auth/logout` | 認証 | ログアウト |
| POST | `/api/auth/change-password` | 認証 | パスワード変更（初回強制変更もこれ） |
| GET | `/api/me` | 認証 | 自分のプロフィールと**権限コード一覧** |

### 営業日（営業モードの切り替え）

| Method | パス | 権限 | 概要 |
|---|---|---|---|
| GET | `/api/business-days?from=&to=` | `reservation.read` | 期間の営業日サマリー（カレンダー用） |
| GET | `/api/business-days/{date}` | `reservation.read` | 1日の設定＋サマリー |
| PUT | `/api/business-days/{date}` | `businessday.write` | モード・繁忙日・定員・営業時間・休業の設定 |

### 予約

| Method | パス | 権限 | 概要 |
|---|---|---|---|
| GET | `/api/reservations` | `reservation.read` | 一覧・検索 |
| POST | `/api/reservations` | `reservation.write` | 登録（席割り当ても同時に可） |
| GET | `/api/reservations/{id}` | `reservation.read` | 詳細（席・履歴を含む） |
| PATCH | `/api/reservations/{id}` | `reservation.write` | 内容変更 |
| POST | `/api/reservations/{id}/status` | `reservation.write` | 状態遷移（確定・来店・完了・キャンセル・no-show） |
| PUT | `/api/reservations/{id}/seats` | `reservation.write`(+`override`) | 席の割り当て・変更・解除 |

### 空き状況・ルール判定

| Method | パス | 権限 | 概要 |
|---|---|---|---|
| GET | `/api/availability` | `reservation.read` | **席候補ごとの空き＋ルール判定**（通常営業）／残定員（イベント営業） |
| GET | `/api/seat-units` | 認証 | 席マスタ |
| GET | `/api/seat-rules` | 認証 | ルール一覧 |
| POST | `/api/seat-rules` | `rule.write` | ルール追加 |
| PATCH | `/api/seat-rules/{id}` | `rule.write` | ルール変更 |
| DELETE | `/api/seat-rules/{id}` | `rule.write` | ルール削除（実体は `is_active=false`） |
| POST | `/api/seat-rules/preview` | `rule.write` | 保存前の判定プレビュー |

### 集計

| Method | パス | 権限 | 概要 |
|---|---|---|---|
| GET | `/api/stats/sources?from=&to=` | `stats.read` | 流入元別の集計 |
| GET | `/api/stats/summary?from=&to=` | `stats.read` | 全体サマリー（曜日別・時間帯別・モード別） |
| GET | `/api/stats/export.csv?from=&to=` | `stats.read` | CSV出力 |

### 管理

| Method | パス | 権限 | 概要 |
|---|---|---|---|
| GET/POST | `/api/accounts` | `account.write` | スタッフ一覧・発行 |
| PATCH | `/api/accounts/{id}` | `account.write` | ロール変更・停止 |
| POST | `/api/accounts/{id}/reset-password` | `account.write` | 初期パスワード再発行 |
| GET/PUT | `/api/settings` | `settings.write` | 店舗設定 |
| GET | `/api/audit-logs` | `audit.read` | 監査ログ |

### 公開・外部連携（認証不要／別の防御）

| Method | パス | 防御 | 概要 |
|---|---|---|---|
| POST | `/api/public/reservations` | Turnstile＋レート制限＋Origin制限 | **HP予約フォームからの受付** |
| GET | `/api/public/business-days?from=&to=` | レート制限 | 休業日・イベント日だけを返す（個人情報なし） |
| POST | `/api/webhooks/line` | `X-Line-Signature` HMAC検証 | 公式LINEのメッセージ受信（Phase 5） |
| POST | `/api/webhooks/instagram` | Meta署名検証 | Instagram DM（Phase 6・要審査） |

---

## 4-2. 主要エンドポイントの詳細

### GET `/api/me`

権限をクライアントに渡すのはUI出し分けのため。**判定の正はサーバー**。

```json
{
  "id": "6f0…", "login_id": "oka", "display_name": "岡",
  "role": "owner", "is_active": true, "must_change_password": false,
  "permissions": ["reservation.read","reservation.write","reservation.override",
                  "businessday.write","rule.write","stats.read","settings.write",
                  "account.write","audit.read"]
}
```

### GET `/api/business-days?from=2026-08-01&to=2026-08-31`

```json
{
  "days": [
    { "biz_date": "2026-08-07", "mode": "normal", "is_busy": true,  "is_closed": false,
      "open_min": 1080, "close_min": 1500,
      "reservation_count": 7, "guest_count": 24, "tentative_count": 1 },
    { "biz_date": "2026-08-11", "mode": "normal", "is_busy": false, "is_closed": true,
      "open_min": 1080, "close_min": 1440,
      "reservation_count": 0, "guest_count": 0, "tentative_count": 0 },
    { "biz_date": "2026-08-16", "mode": "event",  "is_busy": false, "is_closed": false,
      "event_name": "夏のビアホール", "event_capacity": 60,
      "open_min": 1080, "close_min": 1440,
      "reservation_count": 12, "guest_count": 42, "remaining_capacity": 18 }
  ]
}
```

`business_days` に行が無い日も、曜日から導出した既定値で返す（カレンダーに穴を空けない）。

### PUT `/api/business-days/2026-08-16`

```json
{ "mode": "event", "event_name": "夏のビアホール", "event_capacity": 60,
  "is_busy": false, "is_closed": false, "open_min": 1080, "close_min": 1440, "note": "相席・立ち飲みあり" }
```

**200**：更新後の営業日。
**409 `MODE_CHANGE_HAS_SEATS`**：席割り当て済みの予約がある日を `event` にしようとした場合。

```json
{ "error": { "code": "MODE_CHANGE_HAS_SEATS",
             "message": "席の割り当てが3件あります。イベント営業に切り替えると割り当ては無効になります。",
             "details": { "affected_reservations": ["R-2608-0101","R-2608-0107","R-2608-0112"] } } }
```
→ `?force=true` を付けて再送すると実行する（割り当ての行は消さず無効化するので、通常営業に戻せば復活する）。

### GET `/api/reservations`

クエリ：`from` / `to` / `date` / `status`（カンマ区切り）/ `source` / `seat_unit` / `q`（名前・カナ・電話の部分一致）/ `limit`（既定50）/ `cursor`

```json
{
  "total": 7, "total_guests": 24,
  "items": [
    { "id": "…", "reference": "R-2608-0142",
      "biz_date": "2026-08-07",
      "starts_at": "2026-08-07T18:00:00+09:00", "ends_at": "2026-08-07T20:00:00+09:00",
      "party_size": 4, "customer_name": "田中", "customer_kana": "タナカ", "phone": "090…",
      "source": "phone", "source_profile_id": null,
      "status": "confirmed", "is_exclusive": false,
      "course": { "id": "…", "name": "おまかせ宴会コース" }, "drink_plan": true,
      "seats": [ { "seat_unit": { "code": "T1", "name": "テーブル席1", "capacity": 6 },
                   "rule_verdict": "allow", "override_reason": null } ],
      "memo": "誕生日ケーキお預かり" }
  ],
  "next_cursor": null
}
```

### POST `/api/reservations`

```json
{
  "biz_date": "2026-08-07",
  "start_at": "2026-08-07T18:00:00+09:00",
  "duration_min": 120,
  "party_size": 2,
  "customer_name": "佐藤",
  "customer_kana": "サトウ",
  "phone": "0897-00-0000",
  "source": "owner_direct",
  "source_profile_id": "6f0…",
  "status": "confirmed",
  "course_id": null,
  "drink_plan": false,
  "memo": "常連さん",
  "seats": [ { "seat_unit_id": "…T1", "override_reason": "常連。20時以降に増員の可能性あり" } ]
}
```

- `duration_min` 省略時は `settings.default_stay_min`（120分）。
- `source` は**必須**。`owner_direct` のときは `source_profile_id` も必須（400）。
- `seats` は省略可（後から割り当てられる）。
- **イベント営業日**は `seats` を受け付けない（400 `EVENT_DAY_NO_SEATS`）。人数だけを定員に加算する。

**201**

```json
{ "id": "…", "reference": "R-2608-0143", "status": "confirmed",
  "seats": [ { "seat_unit": { "code": "T1" }, "rule_verdict": "deny",
               "matched_rule": { "id": "…", "name": "金土の少人数×大席は原則NG" },
               "override_reason": "常連。20時以降に増員の可能性あり",
               "assigned_by": "6f0…" } ] }
```

**422 `RULE_DENIED`**（理由を書かずに原則NGの席を指定した場合）

```json
{ "error": { "code": "RULE_DENIED",
  "message": "金・土は2名様を6名席へお通ししない運用です。通す場合は理由を入力してください。",
  "details": { "seat_unit_id": "…T1", "rule": { "id": "…", "name": "金土の少人数×大席は原則NG" },
               "overridable": true, "required_field": "override_reason" } } }
```

**409 `CAPACITY_EXCEEDED`**（イベント営業日）

```json
{ "error": { "code": "CAPACITY_EXCEEDED", "message": "定員60名に対し、残り8名です。",
             "details": { "capacity": 60, "booked": 52, "remaining": 8, "requested": 12 } } }
```
→ 定員超過も `?force=true` で通せる（現場判断を止めない）。通した記録は監査ログに残る。

### GET `/api/availability?date=2026-08-07&start=18:00&duration=120&party_size=2`

**この1本が、席割り当てルールの入り口。** 登録画面はこれを叩いて席の選択肢を描く。

通常営業日：

```json
{
  "biz_date": "2026-08-07", "mode": "normal", "is_busy": true, "weekday": 5,
  "window": { "start_at": "2026-08-07T18:00:00+09:00", "end_at": "2026-08-07T20:00:00+09:00" },
  "candidates": [
    { "seat_unit": { "id": "…C", "code": "C", "name": "カウンター", "area": "counter", "capacity": 10, "is_shared": true },
      "available": true, "free_seats": 6,
      "verdict": "allow", "rule": null, "overridable": false },

    { "seat_unit": { "id": "…T1", "code": "T1", "name": "テーブル席1", "area": "table", "capacity": 6, "is_shared": false },
      "available": true, "free_seats": 6,
      "verdict": "deny",
      "rule": { "id": "…", "name": "金土の少人数×大席は原則NG",
                "message": "金・土は2名様を6名席へお通ししない運用です。通す場合は理由を記録してください。" },
      "overridable": true },

    { "seat_unit": { "id": "…P1", "code": "P1", "name": "掘りごたつ個室", "area": "private", "capacity": 8, "is_shared": false },
      "available": false, "free_seats": 0,
      "verdict": "unavailable",
      "conflicts": [ { "reservation_id": "…", "reference": "R-2608-0140",
                       "starts_at": "2026-08-07T18:30:00+09:00", "ends_at": "2026-08-07T21:00:00+09:00" } ] }
  ],
  "suggested_combinations": [
    { "seat_unit_ids": ["…T1","…T2"], "total_capacity": 12, "verdict": "warn",
      "note": "テーブル2卓の連結。12名まで" }
  ]
}
```

イベント営業日：

```json
{ "biz_date": "2026-08-16", "mode": "event", "event_name": "夏のビアホール",
  "capacity": 60, "booked": 42, "remaining": 18, "candidates": [] }
```

**モードによって返す形が変わる**のが要点。画面はこの `mode` を見て、席選択UIと定員UIを描き分ける。

### PUT `/api/reservations/{id}/seats`

```json
{ "seats": [ { "seat_unit_id": "…T1" }, { "seat_unit_id": "…T2" } ],
  "override_reason": "8名。テーブル2卓を連結して対応" }
```

- 空配列 `{"seats": []}` で割り当て解除。
- `deny` を含む場合、`override_reason` が無ければ 422、`reservation.override` 権限が無ければ 403。
- 他の予約と時間帯が重なる専有席を指定すると 409 `SEAT_CONFLICT`（DBの排他制約が最後の砦）。

### POST `/api/reservations/{id}/status`

```json
{ "status": "cancelled", "reason": "体調不良のためキャンセルのお電話" }
```

| 遷移 | 条件 |
|---|---|
| `tentative → confirmed` | いつでも |
| `confirmed → seated` | 当日のみ（前日以前はエラー。誤操作防止） |
| `seated → completed` | いつでも |
| `* → cancelled` | `reason` 必須。席は自動的に解放される |
| `confirmed → no_show` | 営業日当日以降のみ |

### GET `/api/stats/sources?from=2026-07-01&to=2026-07-31`

```json
{
  "period": { "from": "2026-07-01", "to": "2026-07-31" },
  "total": { "reservations": 186, "guests": 642, "cancelled": 11, "no_show": 4 },
  "by_source": [
    { "source": "phone",        "label": "電話",           "reservations": 84, "guests": 268, "cancel_rate": 0.048, "no_show_rate": 0.012 },
    { "source": "line",         "label": "公式LINE",       "reservations": 41, "guests": 156, "cancel_rate": 0.073, "no_show_rate": 0.024 },
    { "source": "instagram_dm", "label": "Instagram DM",   "reservations": 22, "guests":  74, "cancel_rate": 0.090, "no_show_rate": 0.045 },
    { "source": "web_form",     "label": "ホームページ",     "reservations": 19, "guests":  88, "cancel_rate": 0.105, "no_show_rate": 0.052 },
    { "source": "owner_direct", "label": "オーナー直接",     "reservations": 16, "guests":  48, "cancel_rate": 0.000, "no_show_rate": 0.000,
      "by_person": [ { "profile_id": "…", "display_name": "岡",   "reservations": 7 },
                     { "profile_id": "…", "display_name": "古賀", "reservations": 5 },
                     { "profile_id": "…", "display_name": "山本", "reservations": 4 } ] },
    { "source": "walk_in",      "label": "当日飛び込み",     "reservations": 4,  "guests":   8, "cancel_rate": 0.000, "no_show_rate": 0.000 }
  ]
}
```

### POST `/api/public/reservations`（HP予約フォーム）

**認証なし。だからこそ多層で守る。**

```json
{
  "date": "2026-08-20", "time": "19:00", "party_size": 6,
  "customer_name": "鈴木 太郎", "customer_kana": "スズキ タロウ",
  "phone": "090-0000-0000",
  "message": "掘りごたつ個室を希望。1名アレルギー（えび）あり",
  "turnstile_token": "0.xxxxx",
  "hp": ""
}
```

| 防御 | 内容 |
|---|---|
| Turnstile | Cloudflare Turnstile のトークンをサーバーで検証（無料・CAPTCHAレス） |
| ハニーポット | `hp` は画面上見えない項目。値が入っていたら黙って捨てる |
| レート制限 | 同一IP 5件/時、同一電話番号 3件/日 |
| Origin制限 | `Origin` が `https://shipporitei.jp` 以外は拒否（CORSも同オリジンのみ許可） |
| 入力上限 | 人数1〜36、日付は今日〜90日先、`message` 1000文字まで |
| 書き込み | サーバー側の service role のみ。ブラウザに匿名の書き込み権限を渡さない |

**202 Accepted**（※「受け付けた」であって「確定した」ではない）

```json
{ "accepted": true, "reference": "R-2608-0151",
  "notice": "ご予約はまだ確定しておりません。店舗より折り返しご連絡いたします。",
  "day_notice": null }
```

- 登録は必ず `status = "tentative"`, `source = "web_form"`。**席は自動確保しない**。
- 満席・イベント営業日でも受け付ける（断るのは人間の仕事）。ただし `day_notice` で案内を返す：
  `"8月16日はビアホールイベント（相席）の日です。ご了承のうえお申し込みください。"`
- レスポンスに**空席情報を一切含めない**（未認証者に店の埋まり具合を渡さない）。

### POST `/api/webhooks/line`（Phase 5）

- `X-Line-Signature` を channel secret で HMAC-SHA256 検証。**検証前に本文を解釈しない**。
- 受け取ったメッセージを `inbound_messages` に保存（`channel='line'`, `external_id=messageId` で冪等）。
- **自動で予約は作らない**。受信箱（S14）に出し、スタッフが内容を読んで予約化する。
  日本語の「金曜4人でお願いします」を機械が解釈して勝手に席を取る、は事故の元。

---

## 4-3. 内部ドメインロジックの置き場所

APIもServer Actionsも、必ずこの層を通す（同じ判定を2回書かない）：

```
src/lib/
  auth.ts            requireProfile() / requirePermission('reservation.write')
  business-day.ts    ensureBusinessDay() / resolveDay()（行が無い日は曜日から導出）
  availability.ts    listCandidates()  ← /api/availability の実体
  rules.ts           evaluate()        ← ルール判定（DB関数と同じ順序）
  reservations.ts    create/update/assignSeats/changeStatus
  stats.ts           集計クエリ
  time.ts            JST・営業日・open_min/close_min の変換をここに閉じ込める
```

## ネット予約（公開API・ログイン不要）

HP（shipporitei.jp）の「ネット予約」から使う。空席の判定は店内と同じデータ・同じ物差し。

| メソッド/パス | 役割 |
|---|---|
| `GET /api/public/availability?ym=YYYY-MM&party=N` | 月カレンダー（◯/△/×/休）。予約の中身は返さない |
| `GET /api/public/availability?date=YYYY-MM-DD&party=N` | その日の時間枠（15分刻み・開始15分前まで） |
| `POST /api/public/reservations` | 即時確定（〜8名・60日先まで）。source=web_form で登録。席は自動割当 |
| `POST /api/public/cancel` | Webキャンセル（予約番号＋電話番号で本人確認・開始2時間前まで） |

- 画面は `/yoyaku`（予約）と `/yoyaku/cancel`（キャンセル）。
- 書き込みの最後の砦は DB 関数 `net_reserve`（0021）。advisory lock で同日を直列化し、
  再判定と登録を1トランザクションで行うので、同時送信でも席は二重にならない。
- 防衛：ハニーポット欄・同一電話番号は今後の営業日に3件まで・窓口全体で直近10分20件まで。

## 売上の取り込み（週次レポートから）

エアレジの実績を、別リポジトリの「しっぽり亭週次レポート」が POST してくる。

```
POST /api/sales/ingest
ヘッダー: x-api-key: <SALES_INGEST_TOKEN>
本文: { "days": [ { "date": "2026-07-26", "tax10_yen": 57830, "tax8_yen": 622500 }, ... ] }
```

| 項目 | 中身 |
|---|---|
| `date` | 営業日（YYYY-MM-DD）。必須 |
| `actual_yen` | その日の売上合計 |
| `tax10_yen` | **消費税10%対象＝店内飲食**（お酒を含む） |
| `tax8_yen` | **消費税8%対象＝持ち帰り＝物販**（太巻き・オードブル等） |
| `guest_count` | **客数**（エアレジの日別売上より）。お持ち帰りだけのお客様も含む |
| `check_count` | **会計数**＝伝票の枚数（おおよその組数） |
| `target_yen` | 目標。一括投入にも使える |

- **金額はすべて税込。** 税率別だけ税込で総額を税抜にすると、店内が実績を1割上回って
  達成判定が甘くなる。送る側と単位を握ってから税率別の投入を始めること。
- `date` は**営業日**（4時締め）。エアレジの日締めが0時のままだと、金曜25時の売上が
  土曜として届き、同じ夜の予約・シフトと1日ずれる。
- 渡さなかった項目は既存の値を保つ（`null` で上書きしない）。
  **物販を消したいときは `tax8_yen: 0` を明示して送る**（省略は「変更しない」なので、
  エアレジ側で8%の行が無くなっても古い値が残り続ける）。
- `actual_yen` を省いて税率別だけ送った場合は、その合計を実績として扱う。
- 受け口で弾くもの（400）。service role で直接書くため DB関数の検査は通らないので、
  ここが唯一の防波堤になる。
  - 存在しない日付（`2026-02-31` は正規表現を通ってしまう）
  - 同じ `date` の重複（upsert が丸ごと落ちて400件のバッチが全滅する）
  - `tax8_yen > actual_yen`（送信時の値でも、既存の物販と混ぜた後の形でも見る）
  - `tax10_yen + tax8_yen` が `actual_yen` と大きくずれる（10%と8%の取り違え）
- **客単価は保存しない。** 客数と会計数という事実だけ受け、割るのは画面の1か所
  （`src/lib/sales.ts` の `perGuest()`）。**物販は客単価から抜く**（店主指示 2026-08-18・
  分子は「売上 − 物販」）。日毎の売上を店内だけで見ているのと同じ考え方。保存した平均は、あとで実績を直したときに
  置いていかれて必ず食い違う。人数は 0〜10,000 で見る（金額と同じ上限で見ると、
  桁を取り違えた値を素通しする）。0 は送らない——「読めなかった日」と「0名の日」は違う。
- **税率で店内と物販を切り分けるのが肝。** 物販が1日に数十万入ると日商の平均・前年比・
  目標の達成判定がすべて歪むので、混ぜたまま持たない。日本の消費税は店内飲食が10%・
  持ち帰りの食品が8%なので、エアレジの税率別集計がそのまま境目になる。
  （厳密には持ち帰りの酒は10%・店内で食べた太巻きも10%だが、この店の商売では実用上まっすぐ切れる）
- **アプリ本体も物差しを2つ持つ**（店主指示 2026-08）。
  日毎の表示と達成判定（カレンダーの行・売上グリッド・金色・紙吹雪・連続達成・⭐）は
  **店内だけ**、月間の合計と月間目標の達成は**物販込みの合計**。物販は別枠のカードに出す。
  読み替えは `src/lib/sales.ts` の `salesView()` / `hitOf()` の1か所だけで行う。
  店内は「実績 − 物販」。画面に「店内 ＋ 物販 ＝ 合計」が並ぶので、足し算が必ず合う必要がある。
- 分析は `supabase/analysis/01_v_sales_day.sql` のビュー経由で、`dine_in_yen`（店内）と
  `retail_yen`（物販）を使う（アプリと同じ式）。税率別が未取得の日は、物販ゼロとして
  実績をそのまま店内に寄せる。

## 予約インサイト（HPの管理ダッシュボード向け）

しっぽり亭の公式サイト（`site/`）の管理ダッシュボード `shipporitei.jp/dashboard` が、
ビルドのたびにここを読みに来る。

```
GET /api/insights/reservations?days=28
ヘッダー: x-api-key: <INSIGHTS_TOKEN>
```

**返すのは集計だけ。** 氏名・電話番号・受付番号・メモ・アレルギー・請求先は
SQLの select に入れていないので、そもそも取り出していない。

| 中身 | |
|---|---|
| `totals` / `prev` | 予約件数・人数・ネット予約件数・キャンセル・無断キャンセル・貸切 |
| `bySource` | 流入元別の件数（電話／ネット予約／飛び込み／Instagram／LINE…） |
| `daily` | 日別の件数・人数・うちネット予約 |
| `leadTime` | 何日前に予約が入ったかの分布 |
| `byHour` / `byDow` | 来店の時間帯・曜日 |
| `partySize` | 人数帯（1〜2名／3〜4名／…） |

- `days` は 7〜180。既定 28。範囲外は 28 に丸める。
- 数えるのは生きている予約だけ（キャンセルと無断キャンセルは `totals` の専用欄で数える）。
- **列を足すときの決めごと**：それが「誰か1人を指せる情報」になっていないか必ず考えること。
  ダッシュボードは静的HTMLとして配信され、合言葉1つで守られているだけなので、
  そこへ個人情報を送る設計にしてはいけない。
- 受け取る側（`site/scripts/fetch-reserve.mjs`）でも、書き出す前に
  「name / phone / memo …らしきキーが混ざっていないか」を検査して落とす。二重の歯止め。


## ネット予約が入ったときのLINE通知（2026-08-17）

`POST /api/public/reservations` が予約を確定したあと、週次レポートと同じ
LINEグループへ1通 push する（`src/lib/line.ts`）。

ネット予約は誰も電話を受けていないので、アプリを開くまで誰も気づかない。
席ボードのタブレットは音で知らせるが、それは店に居る人にしか届かない。

**送る中身**（電話番号は送らない）:

```
🔔 ネット予約が入りました

8月22日(土) 19:00
田中様 4名
テーブル席

https://yoyaku.shipporitei.jp/day/2026-08-22
```

姓・日時・人数・席と、その日を開くリンクだけ。
気づくのに電話番号は要らず、要るのは実際にかけるとき——それはアプリの中にある。
LINEのトーク履歴は端末にもクラウドにも残り、こちらでは消せないので、出す量を絞る。

**キャンセルされたときも同じグループへ送る**（`finishCancel` から）:

```
❌ ネット予約がキャンセルされました

8月22日(土) 19:00
田中様 4名
T1

https://yoyaku.shipporitei.jp/day/2026-08-22
```

黙っていると誰も席を空けない——当日、来ないお客様のために席を取り置き続ける。
気づくのが遅いほど損が大きいのは、入ったときよりもこちら。
スタッフがアプリからキャンセルしたときは送らない（本人が知っている）。
Webからの経路（リンク／予約番号＋電話番号）の両方が `finishCancel` に集まるので、
そこ1か所から送っている。

**必要な環境変数**（どちらか欠けていれば送らない。予約は通常どおり動く）:

| 変数 | 中身 |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | 公式アカウントのチャンネルアクセストークン |
| `LINE_TARGET_ID` | 送信先のグループID |

**気をつけていること**

- **通知は予約より軽い。** 送信に失敗しても、遅くても、予約は必ず成立させる。
  上限3秒で抜ける。LINEが落ちている日にネット予約が取れなくなるのは本末転倒。
- **返事を返す前に送る。** Vercelの関数は応答後に止められるので、
  「あとで送る」書き方だと送信が消える。
- **ハニーポットに引っかかったボットには送らない。** ボットには「成功したふり」を
  返しているので、それを本物と同じに扱うと、ボットが来るたびにLINEが鳴り、
  月200通の無料枠を食い尽くす（`BOT_REFERENCE` で見分ける）。
- **無料枠は月200通**（宛先数×メッセージ数）。週次レポート4通＋ネット予約の件数。
  月に150件を超えるネット予約が入るようになったら、有料プランを検討する。


## まるごと書き出し（バックアップ）

```
GET /api/cron/backup
ヘッダー: x-api-key: <BACKUP_TOKEN>
```

**なぜ要るか**：Supabase の無料プランにはバックアップが無い。予約・売上・シフト・
スタッフの全部が、この世に1か所しか無い状態だった。誤操作1回、プロジェクトの事故1回で
開業以来の記録が戻せなくなる。

返すのは全テーブルのJSON1枚。

```json
{
  "ok": true,
  "at": "2026-08-18T13:29:11.128Z",
  "order": ["settings", "permissions", ..., "audit_logs"],
  "failed": [],
  "counts": { "reservations": 35, "sales_daily": 1067, "audit_logs": 2707, ... },
  "tables": { "reservations": [ ... ], ... }
}
```

- `order` は**復元する順番**（参照される側が先）。復元スクリプトはこれに従う
- 1つのテーブルで転んでも残りは書き出し、`failed` に名前を入れて返す。
  「全部か無か」にすると、テーブルを1つ増やした日にバックアップが丸ごと止まる
- PostgREST の1000行制限は中でページングしている

**保存先はこのサーバーではない。** 同じ場所に置いた控えは、その場所ごと失うときに
一緒に消えるので控えにならない。呼ぶのは店主のMac（`shippori-report` の
`scripts/weekly-backup.mjs`・毎週月曜8時）で、iCloud Drive にJSONで置く。
Vercel の定期実行から呼ぶ道（`Authorization: Bearer <CRON_SECRET>`）も開けてあるが、
**使っていない**——Vercelから呼ぶと保存先がVercelになるため。

**合言葉は専用のものにした（`BACKUP_TOKEN`）。** Macには既に `SALES_INGEST_TOKEN` が
あるので使い回せば設定は要らないが、あれは「売上の数字を書き込むだけ」の鍵として渡したもの。
同じ鍵で全予約の氏名と電話番号が抜けるようにするのは、渡した意味が変わる。

**この口はDBの全内容を平文で返す。** service_role キーとほぼ同じ重さがあると考えて扱うこと。


## 前日リマインド

```
GET /api/cron/remind
ヘッダー: Authorization: Bearer <CRON_SECRET>
Vercelの定期実行：毎日 19:00 JST（cron は "0 10 * * *" ＝ UTC）
```

明日ご来店のお客様のうち、**LINEで予約された方**にだけ1通お送りする。
電話番号しか無い方には送れない（SMSは費用がかかるうえ、届いても返信できない）。

**当日にお入れいただいた予約には送らない**（店主指示）。今日ご予約くださった方には
その場で控えをお送りしているので、同じ日に2通目が届くと案内ではなく催促に見える。
判定は**日本時間の暦日**で行う（UTCのまま比べると、夜に手で動かしたときだけ9時間ずれる）。

**送った印は予約1件ごとに残す**（`reservations.reminded_at`）。定期実行は
「1日1回きっかり」ではなく、動かなかった日に手で叩くこともある。印が無いと
同じ文面が2通並ぶ——予約の連絡としては一番信用を落とす形。1件ごとなので、
途中で失敗しても次に走ったとき残りから再開できる。

ブロックされた方（`line_friends.unfollowed_at` あり）には送らない。届かないうえ通数だけ減る。

**残り通数が薄い月は、リマインドを止める。** お客様向けアカウントは無料プラン（月200通）で、
使い切ると黙って届かなくなる。困る順番は決まっていて、「ご予約の控えが届かない」ほうが
「リマインドが届かない」より遥かに重い——控えが来ないと、お客様は予約できていないと思う。
何もしなければ先に来たものから使うので、月末に控えのほうが止まる。順番が逆になる。

そこで、リマインドを送る前に残りをLINEに聞き（`/v2/bot/message/quota`）、
控えのぶん（`RESERVED_FOR_BOOKINGS` = 60通）を割り込むなら**その日は送らず、
店のLINEグループに知らせる**。自分で数えないのは、管理画面から手で送ったぶんが
漏れて必ず食い違うため。

残りが**分からないときは送る**。調べられないことを理由に止めると、LINEの調子が悪い日に
誰にも気づかれないまま連絡が止まる。止まったことに気づけない仕組みのほうが危ない。

無断キャンセルにいちばん効くのは、認証を厳しくすることではなく「明日ですよ」の一声だと
考えている。忘れているだけの人は、声をかければ来るか、来られないと言ってくれる。
どちらでも店は助かる。


## 静かな日のクーポン配信

```
GET /api/cron/quiet-day
ヘッダー: Authorization: Bearer <CRON_SECRET>
Vercelの定期実行：毎日 13:00 JST（cron は "0 4 * * *" ＝ UTC）
有効化：QUIET_COUPON_ENABLED=1（配り始める日は店主が決める。既定はオフ）
```

13時の時点でその日の予約が1件も無ければ、お客様向け公式LINEの友だち全員に
「本日限定 生ビール or ハイボール 1杯無料」を配信して空席を埋めにいく（店主要望）。

**これは攻めの機能なので「迷ったら送らない」に倒す**（守りの通知と逆向き）。
送らない条件を上から順に見る：

1. `QUIET_COUPON_ENABLED` がオフ
2. 休業日・イベント日（誰も来られない日に「来てください」は事故）
3. 予約が1件でもある（店主指定の条件そのまま）
4. **前回の配信から7日たっていない**（店主指定） — 静かな日が続く週に毎日届くと、
   案内ではなく安売りの連発に見えてブロックが増える
5. **今月すでに4回配信している**（店主指定） — 7日間隔だけだと月初から刻んだ月に
   5回入る（1日・8日・15日・22日・29日）。「月4回」は別の上限として数える。
   月の区切りは日本時間の暦月
6. **残り通数が読めない・足りない** — 配信は1回で友だちの人数ぶんを使う。
   リマインドは「読めなければ送る」だが、配信は「読めなければ送らない」。
   読めないまま送ると200通を一撃で使い切り、予約の控えが月末に止まりうる

6で止めたときは店のグループに知らせる（黙って止まる仕組みにしない）。
4・5は「決めたとおりに間を空けているだけ」なので毎回は知らせない。

文面には日付を入れる（「8月20日(水) 限定」）——画面提示での使い回しを防ぐ。
`QUIET_COUPON_URL`（LINE公式アカウントの管理画面で作ったクーポンのURL）があれば
そちらを案内し、無ければ「この画面をご提示ください」で成立する。

配信のたびに `line_broadcasts` に記録する（0043）。7日間隔の判定と、
「配信した日に何人来たか」を sales_daily と突き合わせる効果測定のため。
