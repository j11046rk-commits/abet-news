# The Oldman — 運営ダッシュボード

愛媛県松山市の会員制プライベートクラブ「The Oldman」の運営ツール。
ポーカーのレーキを積み立てて毎月の家賃・光熱費に充て、不足分をオーナー6名で分担する。
この画面が答えるべき問いはひとつだけ。

> **「今月、家賃を払えるのか。足りないなら、あと何回開催すればいいのか。」**

| ドキュメント | 内容 |
|---|---|
| [SPEC.md](./SPEC.md) | 機能仕様と将来の拡張ポイント |
| [DESIGN.md](./DESIGN.md) | デザイントークンと判断理由、自己批評 |
| [HANDOFF.md](./HANDOFF.md) | 現状と次の一手（セッション再開用） |
| [ISSUES.md](./ISSUES.md) | 既知の課題 |
| [supabase/README.md](./supabase/README.md) | DBのセットアップ手順 |

## 動かす

```bash
npm install
cp .env.local.example .env.local   # 値は Supabase のプロジェクト設定から
npm run dev
```

`.env.local` に必要な値：

| 変数 | 用途 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクトURL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon キー（RLSが効く） |
| `SUPABASE_SERVICE_ROLE_KEY` | service role キー。**サーバー側のみ**。アカウント発行とパスワード再発行だけに使う |
| `AUTH_EMAIL_DOMAIN` | ログインIDをメールアドレスに変換するときの内部ドメイン（既定 `theoldman.local`） |

DBは `supabase/migrations/` を 0001 から順に流す。手順は [supabase/README.md](./supabase/README.md)。

## スタック

Next.js 15 (App Router) / TypeScript / Tailwind CSS v4 / Supabase (Auth・Postgres・RLS) /
date-fns + @date-fns/tz（`Asia/Tokyo` 固定）。グラフはライブラリを使わず自作SVG。

## 画面

| パス | 内容 | 権限 |
|---|---|---|
| `/` (TOP) | いま施設にいる人、積立ゲージ、不足額、直近の利用状況、直近セッション、繰越残高、今週の予約 | 全員 |
| `/reservations` | 予約の作成・編集。重複は警告するがブロックしない | 全員 |
| `/calendar` | 週/月のカレンダー（独立タブ）。モバイルは3日表示 | 全員 |
| `/sessions` | セッション記録（レーキ額と参加人数のみ）。保存すると台帳にレーキ行が自動起票される | 全員 |
| `/ledger` | 収支台帳・月次グラフ・固定費 | 記帳・編集は6人全員 / 固定費の設定は owner |
| `/members` | 出資額・貸切利用時間・アカウント管理 | 閲覧は全員 / アカウント管理は owner |
| `/settings` | 施設名・月次目標額・オーナー人数・レーキルール | owner のみ |

## 認証

ログインID + パスワードのみ。LINEログインとマジックリンクは使わない。
利用者にメールアドレスは見せず、サーバー側で `{login_id}@theoldman.local` に変換して
Supabase Auth に渡す。自己サインアップは不可で、アカウントはオーナーが `/members` から発行する。
