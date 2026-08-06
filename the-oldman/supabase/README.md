# Supabase セットアップ

## 適用順

```
0001_schema.sql              enum / テーブル / 制約 / インデックス
0002_views.sql               v_monthly_summary / v_session_stats / v_exclusive_hours
0003_rls.sql                 RLS 有効化とポリシー
0004_session_ledger_sync.sql セッション → 台帳の自動起票トリガ
0005_seed.sql                施設設定・固定費・参加者マスタ・過去3ヶ月のダミー
```

Supabase ダッシュボードの **SQL Editor** に上から順に貼って実行するのが最短。
`supabase` CLI を使う場合は `supabase db push`。

## Auth の設定（必須）

1. **Authentication → Providers → Email** を有効化
2. **Confirm email を無効化**
   `{login_id}@theoldman.local` は実在しないドメインなので、確認メールは届かない
3. **Sign-ups を無効化**（自己サインアップ不可。アカウントは owner が管理画面から発行する）

## 最初のオーナーアカウント

アプリの `/members` からアカウントを発行するには、先に owner が1人必要になる。
最初の1人だけ SQL で作る。

```sql
-- 1. Supabase ダッシュボード → Authentication → Users → Add user
--    Email: santiago@theoldman.local
--    Password: 任意（初回ログイン後に変更させる）
--    Auto Confirm User: ON
-- 2. 発行された uuid を控えて、以下を実行

insert into profiles (id, login_id, display_name, role, investment_yen, must_change_password)
values ('<控えた uuid>', 'santiago', 'サンチャゴ', 'owner', 500000, true);
```

以降のアカウントはアプリの `/members` から発行できる。

## ローカルでの検証

Supabase を立てずに Postgres 16 だけで検証する場合、`auth` スキーマの最小スタブを先に作る。

```sql
create schema if not exists auth;
create extension if not exists "pgcrypto";
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
grant usage on schema public, auth to anon, authenticated, service_role;
```

RLS の確認は `set local role authenticated; set local request.jwt.claim.sub='<uuid>';` で行う。
