-- 0001 型定義・スタッフ・権限
-- docs/03-database.md §3-2, §3-3 に対応。

create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";   -- Phase 2 の席の排他制約で使う
create extension if not exists "pg_trgm";      -- お客様名のあいまい検索

do $$ begin
  create type user_role as enum ('owner', 'manager', 'staff', 'viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type business_mode as enum ('normal', 'event');
exception when duplicate_object then null; end $$;

do $$ begin
  create type seat_area as enum ('counter', 'table', 'private');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reservation_source as enum
    ('web_form', 'instagram_dm', 'line', 'phone', 'owner_direct', 'walk_in', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reservation_status as enum
    ('tentative', 'confirmed', 'seated', 'completed', 'no_show', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type rule_effect as enum ('allow', 'warn', 'deny');
exception when duplicate_object then null; end $$;

-- ── スタッフ（auth.users と 1:1）────────────────────────────────
create table if not exists profiles (
  id                   uuid primary key references auth.users on delete cascade,
  login_id             text not null unique,
  display_name         text not null,
  role                 user_role not null default 'staff',
  is_active            boolean not null default true,
  must_change_password boolean not null default true,
  is_owner_contact     boolean not null default false,
  sort_order           integer not null default 100,
  created_at           timestamptz not null default now(),
  constraint profiles_login_id_format check (login_id ~ '^[a-z0-9][a-z0-9._-]{1,30}$')
);

comment on column profiles.login_id is
  'ログイン画面で入力するID。サーバー側で {login_id}@{AUTH_EMAIL_DOMAIN} に変換して Supabase Auth に渡す。';
comment on column profiles.is_owner_contact is
  'オーナー3名など、予約の流入元「オーナー直接」で誰経由かを選ばせる相手。';

-- ── 権限マスタ ───────────────────────────────────────────────
create table if not exists permissions (
  code  text primary key,
  label text not null
);

insert into permissions (code, label) values
  ('reservation.read',     '予約の閲覧'),
  ('reservation.write',    '予約の登録・編集・席割り当て'),
  ('reservation.override', '席ルールの上書き'),
  ('businessday.write',    '営業モード・繁忙日・営業時間の変更'),
  ('rule.write',           '席割り当てルールの編集'),
  ('stats.read',           '集計の閲覧・CSV出力'),
  ('settings.write',       '店舗設定・席マスタ・コースの編集'),
  ('account.write',        'スタッフアカウントの発行・停止'),
  ('audit.read',           '監査ログの閲覧')
on conflict (code) do nothing;

-- ロール → 権限。ここに行を足すだけで権限を細分化できる（コード変更不要）。
create table if not exists role_permissions (
  role       user_role not null,
  permission text not null references permissions(code) on delete cascade,
  primary key (role, permission)
);

insert into role_permissions (role, permission)
select 'owner'::user_role, code from permissions
union all
select 'manager'::user_role, code from permissions where code <> 'account.write'
union all
select 'staff'::user_role, code from permissions
  where code in ('reservation.read', 'reservation.write', 'reservation.override', 'stats.read')
union all
select 'viewer'::user_role, code from permissions where code in ('reservation.read')
on conflict do nothing;

-- ── 判定関数（RLSとAPIが同じものを見る）───────────────────────
create or replace function public.has_permission(perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from profiles p
    join role_permissions rp on rp.role = p.role
    where p.id = auth.uid()
      and p.is_active
      and rp.permission = perm
  )
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.is_active)
$$;

revoke execute on function public.has_permission(text) from public, anon;
revoke execute on function public.is_active_user()     from public, anon;
grant  execute on function public.has_permission(text) to authenticated;
grant  execute on function public.is_active_user()     to authenticated;
