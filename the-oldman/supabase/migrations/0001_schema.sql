-- The Oldman — 0001 schema
-- 金額はすべて円の整数。小数は使わない。
-- タイムゾーンは Asia/Tokyo 固定（保存は timestamptz、表示側で JST に変換）。

create extension if not exists "pgcrypto";

-- ── enum ────────────────────────────────────────────────────────────────
create type user_role           as enum ('owner', 'member');
create type game_type           as enum ('cash', 'tournament', 'other');
create type reservation_purpose as enum ('poker', 'meeting', 'private', 'lodging', 'other');
create type ledger_direction    as enum ('income', 'expense');

-- ── プロフィール（auth.users と 1:1）────────────────────────────────────
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  login_id text not null unique,           -- ログイン画面で入力するID
  display_name text not null,
  role user_role not null default 'member',
  investment_yen integer not null default 0,
  must_change_password boolean not null default true,
  is_active boolean not null default true,
  joined_on date not null default current_date
);

comment on column profiles.login_id is
  'ログイン画面で入力するID。サーバー側で {login_id}@theoldman.local に変換して Supabase Auth に渡す。';

-- ログインIDは英数とハイフン・アンダースコアのみ（メールのローカル部として安全な文字集合）
alter table profiles
  add constraint profiles_login_id_format check (login_id ~ '^[a-z0-9][a-z0-9._-]{1,30}$');

-- ── 参加者マスタ（ゲストを含む。profile_id は任意）──────────────────────
create table players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  profile_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index players_name_key on players (name);
create index players_profile_id_idx on players (profile_id);

-- ── 開催セッション ──────────────────────────────────────────────────────
create table sessions (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  ended_at timestamptz,
  game_type game_type not null default 'cash',
  rake_yen integer not null default 0 check (rake_yen >= 0),
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint sessions_time_order check (ended_at is null or ended_at > started_at)
);

create index sessions_started_at_idx on sessions (started_at desc);

create table session_players (
  session_id uuid references sessions(id) on delete cascade,
  player_id  uuid references players(id)  on delete cascade,
  primary key (session_id, player_id)
);

create index session_players_player_idx on session_players (player_id);

-- ── 予約 ────────────────────────────────────────────────────────────────
create table reservations (
  id uuid primary key default gen_random_uuid(),
  title text,
  purposes reservation_purpose[] not null default '{poker}',  -- 複数選択
  is_exclusive boolean not null default false,                -- 貸切希望
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  headcount integer not null default 1 check (headcount >= 1),
  memo text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservations_time_order check (ends_at > starts_at),
  constraint reservations_purposes_not_empty check (array_length(purposes, 1) >= 1),
  -- 1時間単位（JST は UTC+9 で分オフセットを持たないため、UTC 毎正時 = JST 毎正時）
  constraint reservations_hourly_start check (date_trunc('hour', starts_at) = starts_at),
  constraint reservations_hourly_end   check (date_trunc('hour', ends_at)   = ends_at),
  -- 用途に other を含む場合はメモ必須
  constraint reservations_other_requires_memo
    check (not ('other' = any (purposes)) or (memo is not null and length(btrim(memo)) > 0))
);

comment on column reservations.is_exclusive is
  '貸切希望。用途タグの private（何をするかの分類）とは別物。他メンバーへの「来訪をご遠慮いただきます」の意思表示。';

create index reservations_purposes_idx  on reservations using gin (purposes);
create index reservations_starts_at_idx on reservations (starts_at);
create index reservations_created_by_idx on reservations (created_by);

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger reservations_touch_updated_at
  before update on reservations
  for each row execute function touch_updated_at();

-- ── 収支台帳 ────────────────────────────────────────────────────────────
create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  direction ledger_direction not null,
  category text not null,
  amount_yen integer not null check (amount_yen >= 0),
  memo text,
  session_id uuid references sessions(id) on delete set null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index ledger_entries_date_idx    on ledger_entries (entry_date desc);
create index ledger_entries_session_idx on ledger_entries (session_id);

-- セッション1件につき自動起票のレーキ行は1行だけ
create unique index ledger_entries_session_rake_key
  on ledger_entries (session_id)
  where session_id is not null and category = 'rake';

-- ── 固定費 ──────────────────────────────────────────────────────────────
create table fixed_costs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount_yen integer not null check (amount_yen >= 0),
  billing_day smallint not null check (billing_day between 1 and 28),
  is_active boolean not null default true
);

-- ── 施設設定（1行のみ）─────────────────────────────────────────────────
create table settings (
  id boolean primary key default true check (id),
  facility_name text not null default 'The Oldman',
  monthly_target_yen integer not null default 100000 check (monthly_target_yen > 0),
  owner_count smallint not null default 6 check (owner_count > 0),
  rake_rule text
);
