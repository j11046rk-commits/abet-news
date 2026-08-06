# HANDOFF — 現状と次の一手

最終更新：2026-08-06

---

## 1. いまどこまで出来ているか

| Phase | 内容 | 状態 |
|---|---|---|
| 0 | SPEC.md / DESIGN.md（自己批評つき） | 完了 |
| 1 | Supabaseスキーマ・ビュー・RLS・シード | 完了（ローカルPostgres 16で適用とRLS挙動を実測） |
| 2 | Next.jsシェル・ID+パスワード認証・middleware・デザイントークン | 完了（**実Supabaseとの往復は未検証**） |
| 3 | 予約フォーム + カレンダー（独立タブ） | 完了 |
| 4 | アカウント発行・管理、貸切時間の可視化 | 完了（**実Supabaseとの往復は未検証**） |
| 5 | ダッシュボード + 積立ゲージ | 完了 |
| 6 | セッション記録 | 完了 |
| 7 | 会計台帳 + 月次グラフ + 固定費 + 設定 | 完了 |
| 8 | モバイル最適化・アクセシビリティ・デプロイ手順・本ファイル | 完了（**デプロイ自体は未実施**） |

`npm run build` は通る。全画面をフィクスチャで描画してスクリーンショットを撮り、
デザインの自己批評と修正を各フェーズで行っている（修正内容は `ISSUES.md`）。

---

## 2. 次にやること — 順番どおりに

### ① Supabaseプロジェクトを作る

1. https://supabase.com で新規プロジェクト（リージョンは Northeast Asia (Tokyo) を推奨）
2. SQL Editor に **`supabase/setup.sql` を全文貼って1回 Run**
   （0001〜0004 + 0006 の連結 + 最小限の初期データ。ダミーデータは入らない）
3. Authentication → Providers → Email を有効化し、**Confirm email を無効化**
4. Authentication → **Sign-ups を無効化**（自己サインアップ不可）

### ② 最初のオーナーを1人だけ手で作る

アプリからアカウントを発行するには owner が1人必要。詳細は `supabase/README.md`。

```sql
-- Authentication → Users → Add user で
--   Email: santiago@theoldman.local / Auto Confirm User: ON
-- として作り、発行された uuid を使う
insert into profiles (id, login_id, display_name, role, investment_yen, must_change_password)
values ('<uuid>', 'santiago', 'サンチャゴ', 'owner', 500000, true);
```

### ②-b Claude に全部任せる場合の準備（オーナー指示・2026-08-06）

「指示だけで完結させたい」という方針。以下を用意すれば、プロジェクト作成から
デプロイまでセッション側で完結できる。

#### 1. ネットワーク許可

claude.ai/code の**新規セッション画面**で、メッセージ入力欄のすぐ上にある
クラウドアイコン（環境名「デフォルト」が出ているボタン）→ その行にカーソルを
乗せて右端の**歯車** → ダイアログで：

- **Network access** を `Custom` に
- **Allowed domains** に：

```
api.supabase.com
*.supabase.co
api.vercel.com
```

- **Also include default list of common package managers** に**必ずチェック**
  （外すと npm も PyPI も届かず、ビルドが通らなくなる）

#### 2. トークンを環境変数に置く

同じダイアログの **Environment variables** 欄に、`.env` 形式で1行ずつ：

```
SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxx
VERCEL_TOKEN=xxxxxxxxxxxxxxxx
```

- Supabase の発行元：https://supabase.com/dashboard/account/tokens
- Vercel の発行元：https://vercel.com/account/tokens

**チャットに貼らないこと。** 環境変数欄に入れれば会話履歴に残らず、毎セッション
自動で読める。ただしこの欄はその環境を使う全員から平文で読めるので、
**作業が終わったら両方のトークンを発行元で削除する**（どちらもワンクリックで失効）。

#### 3. これで Claude ができること

| 範囲 | 内容 |
|---|---|
| Supabase | プロジェクト作成 → `setup.sql` 実行 → Auth設定 → 最初のオーナー作成 → キー取得 |
| Vercel | プロジェクト作成 → 環境変数登録 → デプロイ → URL の報告 |
| 検証 | 実データでログイン・予約・セッション記録・台帳の往復確認とスクリーンショット |

Supabase Personal Access Token は**アカウント全体**（他プロジェクトの削除を含む）を
操作できる。それを承知のうえでオーナーが選択した。作業後の削除を必ず行うこと。

#### 4. 反映のタイミング

設定は**新しいセッションから**効く。設定を保存したら、その画面で
リポジトリ `j11046rk-commits/abet-news`、ブランチ `claude/oldman-dashboard-dev-nhgxc6`
を選んで新規セッションを開始し、こう指示する：

> the-oldman/HANDOFF.md を読んで、Supabase の作成からデプロイまで進めて

### ③ ローカルで往復を確認する

**ここがこのプロジェクトで唯一まだ実測できていない部分。** 開発環境に Supabase も Docker も
無かったため、ネットワーク越しの認証とCRUDだけは机上のままになっている。

```bash
cp .env.local.example .env.local   # 実値を入れる
npm run dev
```

確認すべき順序：

1. `/` に未認証でアクセス → `/login` にリダイレクトされるか
2. ログインID + パスワードでログインできるか
3. 初回は `/password` に飛ばされ、変更後に `/` に入れるか
4. `/reservations` で予約を作れるか。重複時に警告が出るか。貸切の警告文が出るか
5. `/sessions` で記録して、`/ledger` にレーキ行が自動で現れるか（DBトリガ）
6. `/members` からアカウントを発行して、その初期パスワードでログインできるか
7. member アカウントで `/ledger` の記帳・編集・削除ができること、`/settings` には入れないこと、
   固定費マスタの追加・削除フォームが出ないこと

### ④ Vercel にデプロイ

```
Framework Preset : Next.js
Root Directory   : the-oldman
Build Command    : npm run build   （既定のまま）
```

Environment Variables に4つを登録する。
`SUPABASE_SERVICE_ROLE_KEY` は **Production / Preview のみ**にし、`NEXT_PUBLIC_` を付けない。

| 変数 | 公開 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | クライアントに出る |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | クライアントに出る |
| `SUPABASE_SERVICE_ROLE_KEY` | **サーバー側のみ** |
| `AUTH_EMAIL_DOMAIN` | サーバー側のみ |

main への push で自動デプロイ。発行されたURLを6人に共有すれば、各自のログインIDで入れる。
`middleware.ts` が未認証を全て `/login` に飛ばすので、URLが漏れても中身は見えない。

> 元プロンプトの §9 には「Cloudflare Pages にデプロイ済み」という記述もあるが、
> §5 の「Vercel にデプロイ」と矛盾するため **Vercel を採用**した。
> Cloudflare に載せる場合は `@cloudflare/next-on-pages` を通し、
> `middleware.ts` と Route Handler を edge runtime に寄せる必要がある（未検証）。

---

## 3. 設計上の判断で、引き継ぐ人が知っておくべきこと

| # | 判断 | 理由 |
|---|---|---|
| 1 | ログインID→email変換はサーバー側の Route Handler のみ | 変換規則をクライアントに露出させないため（SPEC §2-1） |
| 2 | ログイン失敗メッセージはID有無で変えない | 列挙攻撃対策 |
| 3 | `must_change_password` の強制リダイレクトは middleware でなく `(app)/layout.tsx` | middleware でやると全リクエストに profiles の問い合わせが増える |
| 4 | セッション→台帳の自動起票は **DBトリガ**（security definer） | 二重入力を防ぎ、RLSの制限（`session_id` ありの行は誰も触れない）の外側で確実に同期できる |
| 4b | 台帳の記帳・編集・削除は **6人全員**（0006で開放）。owner 限定は固定費マスタ・施設設定・アカウント管理だけ | 会計を一人に属人化させないため。セッション由来の行だけは全員が触れない |
| 5 | 予約の重複はブロックせず警告 | 「話し合いで解決する文化を尊重する」という要件そのもの |
| 6 | 貸切時間は「多い順」に並べるが順位番号を振らない | 罰則も上限も設けず、可視化だけする設計意図（SPEC §3-5） |
| 7 | グラフはライブラリを使わず自作SVG | Recharts の既定は「分析ツールの見た目」を持ち込むため（DESIGN §9-3） |
| 8 | 固定費の当月計上は誰かが押す方式（owner 限定ではない） | cron を持たない構成のため。台帳への insert なので6人全員が実行できる |
| 9 | 「記録する」はマストヘッド（sticky）に置く | 右下フローティングだと右揃えの金額を常に覆っていた |
| 10 | 用途色の「面」用と「文字」用を分けている | claret/pine/ash は暗い背景に文字として置くと読めないため |

---

## 4. 次に手を入れるならここ（優先順）

1. **実Supabaseでの往復確認**（上の③）— 唯一の未検証領域
2. **固定費の自動計上** — `pg_cron` + Edge Function、または Vercel Cron
3. **予約の通知** — 貸切予約が入ったときだけ知らせる。全部通知すると誰も見なくなる
4. **iCalエクスポート** — トークン付きURLで各自のカレンダーアプリに流す
5. **LINEログイン** — ID+パスワードは残したまま併用。`profiles` に `line_user_id` を足して既存アカウントに紐づける

---

## 5. 触るときの注意

- **色を増やさない。** 6色 + カレンダー用途色2色だけ。7色目が要ると感じたら階層の作り方が誤っている（DESIGN §2）
- **中間のフォントサイズを増やさない。** 階層は字間と大文字化で作る（DESIGN §3）
- **`box-shadow` を使わない。** 罫線は上辺のみ（DESIGN §4）
- **絵文字を使わない。** 用途の区別は色 + 字間を広げた極小の大文字ラベル
- **コピーに感嘆符を使わない。** ボタンの語とトーストの語を揃える（「記録する」→「記録しました」）
- 金額はすべて円の整数。`amount` クラスを付けて `tabular-nums` で桁を揃える
