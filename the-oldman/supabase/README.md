# Supabase セットアップ

## いちばん早いやり方

`setup.sql` を SQL Editor に**全文貼って1回 Run するだけ**。
0001・0002・0003・0004・0006 を連結したもので、これで構造・ビュー・RLS・
トリガ・初期設定がすべて入る。ダミーデータは含まない。

```
supabase/setup.sql   ← これ1本
```

デモとして中身の入った画面を見たい場合だけ、あとから `migrations/0005_seed.sql`
を追加で実行する（過去3ヶ月ぶんの架空のセッションと台帳が入る）。

誤って 0005 を本番に流してしまったときの取り消し：

```sql
-- ダミーのセッションを消すと、紐づく台帳のレーキ行もトリガで一緒に消える
delete from sessions;
-- 手で入れたダミーの支出・収入も消す
delete from ledger_entries;
-- ダミーの参加者マスタ（アカウントに紐づいていない行だけ）
delete from players where profile_id is null;
```

## 個別に流す場合の適用順

```
0001_schema.sql              enum / テーブル / 制約 / インデックス
0002_views.sql               v_monthly_summary / v_session_stats / v_exclusive_hours
0003_rls.sql                 RLS 有効化とポリシー
0004_session_ledger_sync.sql セッション → 台帳の自動起票トリガ
0005_seed.sql                【任意・デモ用】施設設定・固定費・参加者・過去3ヶ月のダミー
0006_ledger_write_for_members.sql  台帳の記帳・編集・削除を6人全員に開放
```

本番運用では 0005 を飛ばし、代わりに `setup.sql` の末尾にある
最小限の初期データ（施設設定1行 + 固定費2件）だけを入れる。

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
