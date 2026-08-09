-- しっぽり亭予約管理 デプロイ用 結合マイグレーション（0001〜0020）
-- Supabase の SQL Editor にこのファイルをそのまま貼って1回実行する。
-- 生成元: supabase/migrations/*.sql（個別ファイルが正。編集はそちらへ）


-- ════════ 0001_types_and_profiles.sql ════════

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


-- ════════ 0002_masters.sql ════════

-- 0002 店舗マスタ（席・コース・設定）
-- docs/03-database.md §3-4 に対応。
-- Phase 1 では席の割り当ては行わないが、席名を選ぶための一覧としてマスタは先に置く。

create table if not exists seat_units (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  area        seat_area not null,
  capacity    integer not null check (capacity between 1 and 60),
  min_party   integer not null default 1 check (min_party >= 1),
  is_shared   boolean not null default false,  -- true = 相席可（カウンター）
  is_joinable boolean not null default true,   -- 他ユニットと連結して1組に使えるか
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  note        text
);

-- 合計36席（site/data/site.json の記載と一致）。表記は店主指定（2026-08-08）。
insert into seat_units (code, name, area, capacity, is_shared, is_joinable, sort_order) values
  ('C',  'カウンター', 'counter', 10, true,  false, 10),
  ('T1', 'T1',         'table',    6, false, true,  20),
  ('T2', 'T2',         'table',    6, false, true,  30),
  ('T3', 'T3',         'table',    6, false, true,  40),
  ('P1', '和室',       'private',  8, false, true,  50)
on conflict (code) do nothing;

create table if not exists courses (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  price_yen      integer check (price_yen is null or price_yen >= 0),
  includes_drink boolean not null default false,
  min_party      integer not null default 1,
  note           text,
  sort_order     integer not null default 0,
  is_active      boolean not null default true
);

insert into courses (name, price_yen, includes_drink, min_party, note, sort_order)
select v.name, v.price_yen, v.includes_drink, v.min_party, v.note, v.sort_order
from (values
  ('おまかせ宴会コース',   6000, true, 1, '90分飲み放題付き。季節・ご予算に応じて内容変更', 10),
  ('二次会セット',         1980, true, 2, '21時以降／おばんざい小鉢3種付き',               20),
  ('飲み放題のみ（90分）', 2000, true, 1, '単品追加',                                      30)
) as v(name, price_yen, includes_drink, min_party, note, sort_order)
where not exists (select 1 from courses c where c.name = v.name);

-- 店舗の既定値（キーバリュー）
create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

-- open_min / close_min は「その営業日の 0:00 からの経過分」。18:00=1080 / 24:00=1440 / 25:00=1500。
-- time 型では 25:00 を表現できないため整数で持つ。
insert into settings (key, value) values
  ('closed_weekdays',        '[2]'::jsonb),                                   -- 0=日 … 2=火 … 6=土
  ('default_open_min',       '1080'::jsonb),                                  -- 18:00
  ('default_close_min',      '{"weekday":1440,"friday_saturday":1500}'::jsonb),
  ('default_stay_min',       '120'::jsonb),                                   -- 標準滞在時間
  ('default_event_capacity', '60'::jsonb),                                    -- ビアホール営業の既定定員
  ('max_party_normal',       '36'::jsonb)                                     -- 団体一体利用の上限
on conflict (key) do nothing;


-- ════════ 0003_business_days.sql ════════

-- 0003 営業日（通常営業 / イベント営業の切り替え）
-- docs/03-database.md §3-5 に対応。

create table if not exists business_days (
  biz_date       date primary key,
  mode           business_mode not null default 'normal',
  is_busy        boolean not null default false,
  is_closed      boolean not null default false,
  event_name     text,
  event_capacity integer check (event_capacity is null or event_capacity > 0),
  open_min       integer not null default 1080 check (open_min between 0 and 1440),
  -- default を置いてあるのは、手で1行入れたときに 24:00 閉店として通るようにするため。
  -- 通常は ensure_business_day() が曜日から入れる（金土は 1500）。
  close_min      integer not null default 1440 check (close_min > open_min and close_min <= 2160),
  note           text,
  updated_by     uuid references profiles(id),
  updated_at     timestamptz not null default now(),
  -- イベント営業なら定員が必須（席管理ではなく定員管理に切り替わるため）
  constraint business_days_event_needs_capacity
    check (mode <> 'event' or event_capacity is not null)
);

create index if not exists business_days_mode_idx on business_days (mode) where mode = 'event';
create index if not exists business_days_busy_idx on business_days (biz_date) where is_busy;

-- 行が無い日は曜日から導出する。予約が入る／設定を触るタイミングで実体化する。
create or replace function public.ensure_business_day(d date)
returns business_days language plpgsql security definer set search_path = public as $$
declare
  dow    int := extract(dow from d);          -- 0=日 … 6=土
  closed boolean;
  cmin   int;
  row    business_days;
begin
  closed := coalesce(
    (select value @> to_jsonb(dow) from settings where key = 'closed_weekdays'), false);
  cmin := case when dow in (5, 6) then 1500 else 1440 end;   -- 金土は25:00まで

  insert into business_days (biz_date, mode, is_closed, open_min, close_min)
  values (d, 'normal', closed, 1080, cmin)
  on conflict (biz_date) do nothing;

  select * into row from business_days where biz_date = d;
  return row;
end;
$$;

grant execute on function public.ensure_business_day(date) to authenticated;

create or replace function public.touch_business_day()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists business_days_touch on business_days;
create trigger business_days_touch
  before update on business_days for each row execute function touch_business_day();


-- ════════ 0004_reservations.sql ════════

-- 0004 予約
-- docs/03-database.md §3-6 に対応。

create table if not exists reservations (
  id               uuid primary key default gen_random_uuid(),
  reference        text not null unique,                 -- R-2608-0142（電話口で言える番号）
  biz_date         date not null references business_days(biz_date),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,

  party_size       integer not null check (party_size between 1 and 100),
  customer_name    text not null check (length(btrim(customer_name)) > 0),
  customer_kana    text,
  phone            text,

  -- ▼ 流入元（必須。ここが集計の根幹）
  source            reservation_source not null,
  source_profile_id uuid references profiles(id),        -- owner_direct のとき「誰経由か」
  source_detail     text,                                -- IGアカウント名・紹介者名など
  external_ref      text,                                -- LINEのmessageId等（Phase 5の受信箱と突き合わせる）

  status           reservation_status not null default 'tentative',
  is_exclusive     boolean not null default false,       -- 貸切（25名〜）
  course_id        uuid references courses(id),
  drink_plan       boolean not null default false,
  budget_yen       integer check (budget_yen is null or budget_yen >= 0),
  needs_invoice    boolean not null default false,
  invoice_name     text,
  allergy          text,
  memo             text,

  -- Phase 1 の席欄。ここは「T1」「カウンター」等をメモとして書くだけで、
  -- 席の重複判定は行わない。本格的な席管理は Phase 2（reservation_seats）で入れる。
  seat_note        text,

  cancelled_at     timestamptz,
  cancel_reason    text,
  created_by       uuid references profiles(id),
  updated_by       uuid references profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint reservations_time_order check (ends_at > starts_at),
  -- オーナー直通なら誰経由かを必ず記録する
  constraint reservations_owner_direct_needs_person
    check (source <> 'owner_direct' or source_profile_id is not null),
  -- キャンセルは理由を残す
  constraint reservations_cancel_reason
    check (status <> 'cancelled' or (cancel_reason is not null and length(btrim(cancel_reason)) > 0))
);

create index if not exists reservations_bizdate_idx on reservations (biz_date, starts_at);
create index if not exists reservations_status_idx  on reservations (status)
  where status in ('tentative', 'confirmed', 'seated');
create index if not exists reservations_source_idx  on reservations (source, biz_date);
create index if not exists reservations_phone_idx   on reservations (phone);
create index if not exists reservations_name_trgm   on reservations using gin (customer_name gin_trgm_ops);

-- ── 受付番号の採番（R-YYMM-NNNN）─────────────────────────────
create table if not exists reference_counters (
  period text primary key,
  n      integer not null default 0
);

-- security definer：reference_counters は RLS でスタッフに直接触らせない。
-- 採番はこの関数の中でだけ起きる。
create or replace function public.assign_reference()
returns trigger language plpgsql security definer set search_path = public as $$
declare p text; v int;
begin
  if new.reference is not null then return new; end if;
  p := to_char(new.biz_date, 'YYMM');
  insert into reference_counters (period, n) values (p, 1)
    on conflict (period) do update set n = reference_counters.n + 1
    returning n into v;
  new.reference := 'R-' || p || '-' || lpad(v::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists reservations_assign_reference on reservations;
create trigger reservations_assign_reference
  before insert on reservations for each row execute function assign_reference();

-- NOT NULL は BEFORE トリガの後に検査される。
-- したがってアプリは reference を渡さなくてよい（トリガが埋める）。

-- biz_date の行を必ず存在させる（営業モードが常に解決できる状態を保つ）
create or replace function public.reservations_ensure_day()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_business_day(new.biz_date);
  return new;
end;
$$;

drop trigger if exists reservations_ensure_day_trg on reservations;
create trigger reservations_ensure_day_trg
  before insert or update of biz_date on reservations
  for each row execute function reservations_ensure_day();

-- 更新時刻とキャンセル時刻の面倒を見る
create or replace function public.reservations_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
  end if;
  if new.status <> 'cancelled' then
    new.cancelled_at := null;
    new.cancel_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists reservations_touch_trg on reservations;
create trigger reservations_touch_trg
  before update on reservations for each row execute function reservations_touch();


-- ════════ 0007_views.sql ════════

-- 0007 集計ビュー（Phase 1 で必要なぶんだけ）
-- docs/03-database.md §3-10 に対応。
-- v_rule_overrides は席割り当て（Phase 2）の reservation_seats に依存するため、ここには入れない。
--
-- security_invoker = true：ビューを引いた人の権限で下のテーブルを読む。
-- これが無いとビュー越しに RLS を素通りしてしまう。

create or replace view v_daily_summary with (security_invoker = true) as
select
  b.biz_date,
  b.mode,
  b.is_busy,
  b.is_closed,
  b.event_name,
  b.event_capacity,
  b.open_min,
  b.close_min,
  count(r.id) filter (
    where r.status in ('tentative', 'confirmed', 'seated', 'completed')
  ) as reservation_count,
  coalesce(sum(r.party_size) filter (
    where r.status in ('tentative', 'confirmed', 'seated', 'completed')
  ), 0) as guest_count,
  count(r.id) filter (where r.status = 'tentative') as tentative_count,
  count(r.id) filter (where r.status = 'cancelled') as cancelled_count,
  count(r.id) filter (where r.status = 'no_show')   as no_show_count,
  case when b.mode = 'event'
       then b.event_capacity - coalesce(sum(r.party_size) filter (
              where r.status in ('tentative', 'confirmed', 'seated', 'completed')
            ), 0)
       else null end as remaining_capacity
from business_days b
left join reservations r on r.biz_date = b.biz_date
group by b.biz_date;

create or replace view v_source_stats with (security_invoker = true) as
select
  r.biz_date,
  r.source,
  r.source_profile_id,
  count(*)                                       as total,
  count(*) filter (where r.status = 'cancelled') as cancelled,
  count(*) filter (where r.status = 'no_show')   as no_show,
  sum(r.party_size)                              as guests
from reservations r
group by r.biz_date, r.source, r.source_profile_id;

grant select on v_daily_summary, v_source_stats to authenticated;
revoke all on v_daily_summary, v_source_stats from anon;


-- ════════ 0008_audit.sql ════════

-- 0008 監査ログ
-- docs/03-database.md §3-9 に対応。
-- 誰がいつ何を書き換えたかを追えるようにする。予約には氏名と電話番号が入るため、これは必須。

create table if not exists audit_logs (
  id           bigserial primary key,
  actor        uuid references profiles(id),
  action       text not null,           -- 'reservations.update' 等
  target_table text not null,
  target_id    text,
  before       jsonb,
  after        jsonb,
  at           timestamptz not null default now()
);

create index if not exists audit_logs_at_idx     on audit_logs (at desc);
create index if not exists audit_logs_target_idx on audit_logs (target_table, target_id);

-- 主キーの列名はテーブルごとに違う（reservations は id、business_days は biz_date）ので、
-- トリガ引数で受け取る。既定は 'id'。
create or replace function public.write_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  key_col text  := coalesce(tg_argv[0], 'id');
  rec     jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into audit_logs (actor, action, target_table, target_id, before, after)
  values (
    auth.uid(),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    rec ->> key_col,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists reservations_audit on reservations;
create trigger reservations_audit
  after insert or update or delete on reservations
  for each row execute function write_audit('id');

drop trigger if exists business_days_audit on business_days;
create trigger business_days_audit
  after insert or update or delete on business_days
  for each row execute function write_audit('biz_date');

drop trigger if exists profiles_audit on profiles;
create trigger profiles_audit
  after insert or update or delete on profiles
  for each row execute function write_audit('id');


-- ════════ 0009_rls.sql ════════

-- 0009 行レベルセキュリティ
-- docs/03-database.md §3-11 に対応（Phase 1 のテーブルぶん）。
--
-- 方針：アプリを信用しない。アプリのバグでURLを直接叩かれても、DBが拒否する。

alter table profiles           enable row level security;
alter table permissions        enable row level security;
alter table role_permissions   enable row level security;
alter table seat_units         enable row level security;
alter table courses            enable row level security;
alter table settings           enable row level security;
alter table business_days      enable row level security;
alter table reservations       enable row level security;
alter table reference_counters enable row level security;
alter table audit_logs         enable row level security;

-- 未ログイン（anon）には一切与えない。
-- 公開予約フォーム（Phase 3）はサーバー側の service_role 経由でのみ書き込む。
revoke all on all tables in schema public from anon;

grant select on permissions, role_permissions, seat_units, courses, settings to authenticated;
grant select, insert, update on business_days to authenticated;
grant select, insert, update on reservations  to authenticated;
grant select, insert, update on profiles      to authenticated;
grant select on audit_logs to authenticated;

-- ── スタッフ ────────────────────────────────────────────────
drop policy if exists profiles_select_self on profiles;
create policy profiles_select_self on profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists profiles_select_all on profiles;
create policy profiles_select_all on profiles
  for select to authenticated using (is_active_user());

drop policy if exists profiles_write on profiles;
create policy profiles_write on profiles
  for all to authenticated
  using (has_permission('account.write'))
  with check (has_permission('account.write'));

-- 「自分の行なら更新できる」ポリシーは置かない。
-- RLS は列を絞れないので、それを許すと一般スタッフが自分の role を owner に書き換えられる。
-- 初回パスワード変更で must_change_password を false にするのは、
-- サーバー側の API（service_role）が行う（src/app/api/auth/password/route.ts）。

-- ── 権限マスタ（読むだけ）───────────────────────────────────
drop policy if exists permissions_select on permissions;
create policy permissions_select on permissions
  for select to authenticated using (is_active_user());

drop policy if exists role_permissions_select on role_permissions;
create policy role_permissions_select on role_permissions
  for select to authenticated using (is_active_user());

-- ── 予約 ────────────────────────────────────────────────────
drop policy if exists reservations_select on reservations;
create policy reservations_select on reservations
  for select to authenticated using (is_active_user() and has_permission('reservation.read'));

drop policy if exists reservations_insert on reservations;
create policy reservations_insert on reservations
  for insert to authenticated with check (has_permission('reservation.write'));

drop policy if exists reservations_update on reservations;
create policy reservations_update on reservations
  for update to authenticated
  using (has_permission('reservation.write'))
  with check (has_permission('reservation.write'));

-- DELETE は誰にも許可しない。キャンセルは status の変更として残す。

-- ── 営業日 ──────────────────────────────────────────────────
drop policy if exists business_days_select on business_days;
create policy business_days_select on business_days
  for select to authenticated using (is_active_user());

drop policy if exists business_days_write on business_days;
create policy business_days_write on business_days
  for all to authenticated
  using (has_permission('businessday.write'))
  with check (has_permission('businessday.write'));

-- 予約を入れると ensure_business_day() が行を作る。
-- あの関数は security definer なので、予約担当者に businessday.write は要らない。

-- ── マスタ ──────────────────────────────────────────────────
drop policy if exists seat_units_select on seat_units;
create policy seat_units_select on seat_units
  for select to authenticated using (is_active_user());

drop policy if exists seat_units_write on seat_units;
create policy seat_units_write on seat_units
  for all to authenticated
  using (has_permission('settings.write'))
  with check (has_permission('settings.write'));

drop policy if exists courses_select on courses;
create policy courses_select on courses
  for select to authenticated using (is_active_user());

drop policy if exists courses_write on courses;
create policy courses_write on courses
  for all to authenticated
  using (has_permission('settings.write'))
  with check (has_permission('settings.write'));

drop policy if exists settings_select on settings;
create policy settings_select on settings
  for select to authenticated using (is_active_user());

drop policy if exists settings_write on settings;
create policy settings_write on settings
  for all to authenticated
  using (has_permission('settings.write'))
  with check (has_permission('settings.write'));

-- ── 採番カウンタ ────────────────────────────────────────────
-- ポリシーを1つも作らない＝誰も直接触れない。
-- 採番は assign_reference()（security definer）の中でだけ起きる。

-- ── 監査ログ ────────────────────────────────────────────────
-- 読むだけ。書き込みは security definer のトリガのみ。誰も書き換えられない。
drop policy if exists audit_select on audit_logs;
create policy audit_select on audit_logs
  for select to authenticated using (has_permission('audit.read'));


-- ════════ 0011_shifts.sql ════════

-- 0011 シフト（その日に誰が入っているか）
-- 店主フィードバック（2026-08-08）：既存アプリの「バイトのシフトも一目で見れる」を引き継ぐ。
-- 暦（月ビュー）と日別画面に、その日のシフトを名前チップで出すための最小のテーブル。

create table if not exists shifts (
  biz_date   date not null,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  primary key (biz_date, profile_id)
);

create index if not exists shifts_date_idx on shifts (biz_date);

-- 確定シフトを組めるのは店長とオーナーだけ（スタッフは希望を出す側。0012参照）
insert into permissions (code, label) values ('shift.write', '確定シフトの編集')
on conflict (code) do nothing;

insert into role_permissions (role, permission)
select unnest(array['owner','manager']::user_role[]), 'shift.write'
on conflict do nothing;

alter table shifts enable row level security;
revoke all on shifts from anon;
grant select, insert, delete on shifts to authenticated;
-- update は無い。シフトは「入っている／いない」の2状態しかないので、行の有無だけで持つ。

drop policy if exists shifts_select on shifts;
create policy shifts_select on shifts
  for select to authenticated using (is_active_user());

drop policy if exists shifts_write on shifts;
create policy shifts_write on shifts
  for all to authenticated
  using (has_permission('shift.write'))
  with check (has_permission('shift.write'));

drop trigger if exists shifts_audit on shifts;
create trigger shifts_audit
  after insert or delete on shifts
  for each row execute function write_audit('biz_date');


-- ════════ 0012_shift_requests.sql ════════

-- 0012 希望シフト（店主フィードバック 2026-08-08）
--
-- 店長以外のスタッフは、毎月25日までに「次の月に入れる日」を出す。
-- 店長（とオーナー）はそれを見ながら確定シフト（shifts）を組む。
-- 希望と確定を別のテーブルに分けるのは、「出した希望」と「決まった結果」を
-- 混ぜないため。希望は本人の行しか書けない。

create table if not exists shift_requests (
  biz_date   date not null,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (biz_date, profile_id)
);

create index if not exists shift_requests_date_idx on shift_requests (biz_date);

insert into permissions (code, label) values ('shiftrequest.write', '希望シフトの提出')
on conflict (code) do nothing;

-- 提出できるのは一般スタッフのみ（店長は組む側、オーナーはシフトに入らない）
insert into role_permissions (role, permission)
values ('staff', 'shiftrequest.write')
on conflict do nothing;

alter table shift_requests enable row level security;
revoke all on shift_requests from anon;
-- 読み取りのみ。書き込みは 0014 の submit_month_requests（security definer）だけが行う。
-- テーブルへの直接書き込みを許すと、締切（毎月25日）をAPI直叩きで素通りできてしまう。
grant select on shift_requests to authenticated;

drop policy if exists shift_requests_select on shift_requests;
create policy shift_requests_select on shift_requests
  for select to authenticated using (is_active_user());

drop policy if exists shift_requests_write on shift_requests;

drop trigger if exists shift_requests_audit on shift_requests;
create trigger shift_requests_audit
  after insert or delete on shift_requests
  for each row execute function write_audit('biz_date');


-- ════════ 0013_shift_flow.sql ════════

-- 0013 シフトの提出と確定（店主フィードバック 2026-08-08 その8）
--
-- 「出した・出していない」「確定した・していない」を月単位で持つ。
-- - shift_request_submissions：スタッフが希望を「提出」した記録（誰がいつ）
-- - shift_publications：店長がその月のシフトを「確定」した記録
-- 確定されるまで、shifts の行があっても暦には表示しない。

create table if not exists shift_request_submissions (
  ym           text not null check (ym ~ '^[0-9]{4}-[0-9]{2}$'),
  profile_id   uuid not null references profiles(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  primary key (ym, profile_id)
);

alter table shift_request_submissions enable row level security;
revoke all on shift_request_submissions from anon;
-- 読み取りのみ。提出記録は 0014 の関数だけが書く（提出時刻の偽造を防ぐ）。
grant select on shift_request_submissions to authenticated;

drop policy if exists shift_request_submissions_select on shift_request_submissions;
create policy shift_request_submissions_select on shift_request_submissions
  for select to authenticated using (is_active_user());

drop policy if exists shift_request_submissions_write on shift_request_submissions;

create table if not exists shift_publications (
  ym           text primary key check (ym ~ '^[0-9]{4}-[0-9]{2}$'),
  published_at timestamptz not null default now(),
  published_by uuid references profiles(id)
);

alter table shift_publications enable row level security;
revoke all on shift_publications from anon;
-- 読み取りのみ。確定の記録は 0014 の関数だけが書く（published_by は必ず本人になる）。
grant select on shift_publications to authenticated;

drop policy if exists shift_publications_select on shift_publications;
create policy shift_publications_select on shift_publications
  for select to authenticated using (is_active_user());

drop policy if exists shift_publications_write on shift_publications;


-- ════════ 0014_shift_tx.sql ════════

-- 0014 シフトの保存を1トランザクションに
--
-- 「月まるごと削除→挿入→記録」をアプリから3回に分けて呼ぶと、
-- 途中で失敗したときに確定済みシフトが消えたままになる。
-- DB関数に寄せて、全部成功するか全部無かったことになるかの二択にする。
-- security definer なので、権限と締切の検査は関数の中で必ず行う
-- （PostgRESTから直接叩かれても抜け道にならない）。

-- ── 希望シフトの提出（一般スタッフ・自分の分だけ・締切つき）──
create or replace function public.submit_month_requests(p_ym text, p_dates date[])
returns void language plpgsql security definer set search_path = public as $$
declare
  d_from date;
  d_to   date;
  target_ym text;
begin
  if not has_permission('shiftrequest.write') then
    raise exception '権限がありません。';
  end if;
  if p_ym !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception '月が不正です。';
  end if;

  -- 対象は翌月分だけ・毎月25日締切（日本時間）
  target_ym := to_char(date_trunc('month', (now() at time zone 'Asia/Tokyo')::date) + interval '1 month', 'YYYY-MM');
  if p_ym <> target_ym then
    raise exception '希望を出せるのは来月分だけです。';
  end if;
  if extract(day from (now() at time zone 'Asia/Tokyo')) > 25 then
    raise exception '来月分の提出は毎月25日で締め切りです。変更は店長に伝えてください。';
  end if;

  d_from := (p_ym || '-01')::date;
  d_to   := (d_from + interval '1 month' - interval '1 day')::date;

  if exists (select 1 from unnest(p_dates) d where d < d_from or d > d_to) then
    raise exception '日付が不正です。';
  end if;

  delete from shift_requests
   where profile_id = auth.uid() and biz_date between d_from and d_to;

  insert into shift_requests (biz_date, profile_id)
  select distinct d, auth.uid() from unnest(p_dates) d;

  insert into shift_request_submissions (ym, profile_id, submitted_at)
  values (p_ym, auth.uid(), now())
  on conflict (ym, profile_id) do update set submitted_at = now();
end;
$$;

-- ── シフトの確定（店長・オーナー）──
create or replace function public.confirm_month_shifts(p_ym text, p_assignments jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  d_from date;
  d_to   date;
begin
  if not has_permission('shift.write') then
    raise exception '権限がありません。';
  end if;
  if p_ym !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception '月が不正です。';
  end if;

  d_from := (p_ym || '-01')::date;
  d_to   := (d_from + interval '1 month' - interval '1 day')::date;

  if exists (
    select 1 from jsonb_array_elements(p_assignments) a
    where (a->>'date')::date < d_from or (a->>'date')::date > d_to
  ) then
    raise exception '日付が不正です。';
  end if;

  -- オーナー・閲覧のみ・退職者はシフトに入れられない
  if exists (
    select 1 from (
      select distinct (a->>'profile_id')::uuid as pid from jsonb_array_elements(p_assignments) a
    ) x
    left join profiles p on p.id = x.pid
    where p.id is null or not p.is_active or p.role in ('owner', 'viewer')
  ) then
    raise exception 'シフトに入れられない人が含まれています。';
  end if;

  delete from shifts where biz_date between d_from and d_to;

  insert into shifts (biz_date, profile_id, created_by)
  select distinct (a->>'date')::date, (a->>'profile_id')::uuid, auth.uid()
  from jsonb_array_elements(p_assignments) a;

  insert into shift_publications (ym, published_at, published_by)
  values (p_ym, now(), auth.uid())
  on conflict (ym) do update set published_at = now(), published_by = auth.uid();
end;
$$;

-- 監査：希望・提出記録・確定記録の変更も追えるようにする
drop trigger if exists shift_requests_audit on shift_requests;
create trigger shift_requests_audit
  after insert or delete on shift_requests
  for each row execute function write_audit('biz_date');

drop trigger if exists shift_request_submissions_audit on shift_request_submissions;
create trigger shift_request_submissions_audit
  after insert or update or delete on shift_request_submissions
  for each row execute function write_audit('ym');

drop trigger if exists shift_publications_audit on shift_publications;
create trigger shift_publications_audit
  after insert or update or delete on shift_publications
  for each row execute function write_audit('ym');

revoke execute on function public.submit_month_requests(text, date[]) from public, anon;
revoke execute on function public.confirm_month_shifts(text, jsonb)   from public, anon;
grant  execute on function public.submit_month_requests(text, date[]) to authenticated;
grant  execute on function public.confirm_month_shifts(text, jsonb)   to authenticated;


-- ════════ 0015_day_shift_edit.sql ════════

-- 0015 確定後のシフトを日単位で直せるように（店主フィードバック 2026-08-08 その9）
--
-- 急な休みや交代は、月まるごと組み直すほどのことではない。
-- 確定済みの月に限り、その日のぶんだけ入れ替える関数を用意する。
-- 0014 と同じく security definer で、権限・対象者・確定済みかの検査は
-- 関数の中で必ず行う（PostgRESTから直接叩かれても抜け道にならない）。

create or replace function public.update_day_shifts(p_date date, p_profile_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_permission('shift.write') then
    raise exception '権限がありません。';
  end if;

  -- 未確定の月はシフト表から月ごと確定する（この関数は手直し専用）
  if not exists (
    select 1 from shift_publications where ym = to_char(p_date, 'YYYY-MM')
  ) then
    raise exception 'この月はまだ確定していません。シフト表から確定してください。';
  end if;

  -- オーナー・閲覧のみ・退職者はシフトに入れられない（0014 と同じ）
  if exists (
    select 1 from (select distinct unnest(p_profile_ids) as pid) x
    left join profiles p on p.id = x.pid
    where p.id is null or not p.is_active or p.role in ('owner', 'viewer')
  ) then
    raise exception 'シフトに入れられない人が含まれています。';
  end if;

  delete from shifts where biz_date = p_date;

  insert into shifts (biz_date, profile_id, created_by)
  select distinct p_date, x.pid, auth.uid()
  from unnest(p_profile_ids) as x(pid);
end;
$$;

revoke execute on function public.update_day_shifts(date, uuid[]) from public, anon;
grant  execute on function public.update_day_shifts(date, uuid[]) to authenticated;

-- shifts も 0012/0013 と同じく読み取り専用へ。
-- 書き込みは confirm_month_shifts（0014）と update_day_shifts（この関数）だけが行う。
-- テーブルへの直接書き込みを許すと、対象者の検査（オーナー除外など）を素通りできてしまう。
revoke insert, delete on shifts from authenticated;
drop policy if exists shifts_write on shifts;


-- ════════ 0016_hours_and_capacity.sql ════════

-- 0016 営業時間とイベント定員の既定値変更（店主フィードバック 2026-08-08 その10）
--
-- 営業時間はどの曜日も 18:00〜24:00（金土だけ25:00まで、をやめる）。
-- イベント営業の既定定員は 60 → 36 名（店の席数と同じ）。
-- 個別の日で営業時間を変える機能はそのまま（既定値だけの変更）。

update settings set value = '{"weekday":1440,"friday_saturday":1440}'::jsonb
 where key = 'default_close_min';

update settings set value = '36'::jsonb
 where key = 'default_event_capacity';

-- 行が無い日を曜日から実体化する関数も 24:00 閉店に揃える
create or replace function public.ensure_business_day(d date)
returns business_days language plpgsql security definer set search_path = public as $$
declare
  dow    int := extract(dow from d);          -- 0=日 … 6=土
  closed boolean;
  row    business_days;
begin
  closed := coalesce(
    (select value @> to_jsonb(dow) from settings where key = 'closed_weekdays'), false);

  insert into business_days (biz_date, mode, is_closed, open_min, close_min)
  values (d, 'normal', closed, 1080, 1440)
  on conflict (biz_date) do nothing;

  select * into row from business_days where biz_date = d;
  return row;
end;
$$;

-- 旧既定（金土25:00）のまま実体化された行を 24:00 に揃える。
-- まだ運用開始前なので一括でよい。手動で25:00超に設定し直した日ができたら、その日は個別設定として残る。
update business_days set close_min = 1440 where close_min = 1500;


-- ════════ 0017_hours_correction.sql ════════

-- 0017 営業時間の訂正（店主フィードバック 2026-08-08 その11）
--
-- 「18:00〜24:00」はイベント営業のときだけ、だった。
-- 通常営業は従来どおり平日24:00・金土25:00閉店に戻す。
-- （0016 のうちイベント既定定員36はそのまま）

update settings set value = '{"weekday":1440,"friday_saturday":1500}'::jsonb
 where key = 'default_close_min';

-- 行が無い日を曜日から実体化する関数も金土25:00に戻す
create or replace function public.ensure_business_day(d date)
returns business_days language plpgsql security definer set search_path = public as $$
declare
  dow    int := extract(dow from d);          -- 0=日 … 6=土
  closed boolean;
  cmin   int;
  row    business_days;
begin
  closed := coalesce(
    (select value @> to_jsonb(dow) from settings where key = 'closed_weekdays'), false);
  cmin := case when dow in (5, 6) then 1500 else 1440 end;   -- 金土は25:00まで

  insert into business_days (biz_date, mode, is_closed, open_min, close_min)
  values (d, 'normal', closed, 1080, cmin)
  on conflict (biz_date) do nothing;

  select * into row from business_days where biz_date = d;
  return row;
end;
$$;

-- 0016 で 24:00 に寄せてしまった金土の通常営業の行を 25:00 に戻す。
-- まだ運用開始前なので一括でよい（イベント営業の行は触らない）。
update business_days set close_min = 1500
 where mode = 'normal' and close_min = 1440
   and extract(dow from biz_date) in (5, 6);


-- ════════ 0018_sales.sql ════════

-- 0018 売上（日毎の目標と実績）（店主フィードバック 2026-08-08 その12）
--
-- カレンダーと売上タブに「目標◯円・実績◯円」を出すための最小のテーブル。
-- 実績はエアレジ→週次レポート（別リポジトリ）から /api/sales/ingest に
-- 送り込む前提。目標と実績の手入力は営業日の設定画面からもできる。

create table if not exists sales_daily (
  biz_date   date primary key,
  target_yen integer check (target_yen is null or target_yen >= 0),
  actual_yen integer check (actual_yen is null or actual_yen >= 0),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

insert into permissions (code, label) values ('sales.write', '売上目標・実績の入力')
on conflict (code) do nothing;

insert into role_permissions (role, permission)
select unnest(array['owner','manager']::user_role[]), 'sales.write'
on conflict do nothing;

alter table sales_daily enable row level security;
revoke all on sales_daily from anon;
-- 読み取りは全員（みんなが目標と実績を見られるように・店主指定）。
-- 書き込みは下の関数（と service role の取り込みAPI）だけが行う。
grant select on sales_daily to authenticated;

drop policy if exists sales_daily_select on sales_daily;
create policy sales_daily_select on sales_daily
  for select to authenticated using (is_active_user());

create or replace function public.set_sales_day(p_date date, p_target integer, p_actual integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_permission('sales.write') then
    raise exception '権限がありません。';
  end if;
  if p_target is not null and p_target < 0 then
    raise exception '金額が不正です。';
  end if;
  if p_actual is not null and p_actual < 0 then
    raise exception '金額が不正です。';
  end if;

  -- null は「触らない」。消したいときは 0 を入れる。
  insert into sales_daily (biz_date, target_yen, actual_yen, updated_by)
  values (p_date, p_target, p_actual, auth.uid())
  on conflict (biz_date) do update
    set target_yen = coalesce(p_target, sales_daily.target_yen),
        actual_yen = coalesce(p_actual, sales_daily.actual_yen),
        updated_by = auth.uid(),
        updated_at = now();
end;
$$;

revoke execute on function public.set_sales_day(date, integer, integer) from public, anon;
grant  execute on function public.set_sales_day(date, integer, integer) to authenticated;

drop trigger if exists sales_daily_audit on sales_daily;
create trigger sales_daily_audit
  after insert or update or delete on sales_daily
  for each row execute function write_audit('biz_date');


-- ════════ 0019_sales_targets_2026.sql ════════

-- 0019 日次売上目標 2026年6月〜12月（店主提供のPDFから投入・2026-08-08）
--
-- 月間目標を曜日指数で日毎に配分した値（火曜定休は目標なし）。
-- 各月の日毎合計はPDF記載の月間目標と一致（配分の丸めで数円の差のみ）。
-- 実績（actual_yen）には触らない。目標だけを入れ直す。

insert into sales_daily (biz_date, target_yen)
values
  ('2026-06-01', 98299),
  ('2026-06-03', 87729),
  ('2026-06-04', 84558),
  ('2026-06-05', 147976),
  ('2026-06-06', 145862),
  ('2026-06-07', 83501),
  ('2026-06-08', 98299),
  ('2026-06-10', 87729),
  ('2026-06-11', 84558),
  ('2026-06-12', 147976),
  ('2026-06-13', 145862),
  ('2026-06-14', 83501),
  ('2026-06-15', 98299),
  ('2026-06-17', 87729),
  ('2026-06-18', 84558),
  ('2026-06-19', 147976),
  ('2026-06-20', 145862),
  ('2026-06-21', 83501),
  ('2026-06-22', 98299),
  ('2026-06-24', 87729),
  ('2026-06-25', 84558),
  ('2026-06-26', 147976),
  ('2026-06-27', 145862),
  ('2026-06-28', 83501),
  ('2026-06-29', 98299),
  ('2026-07-01', 82849),
  ('2026-07-02', 79855),
  ('2026-07-03', 139746),
  ('2026-07-04', 137750),
  ('2026-07-05', 78857),
  ('2026-07-06', 92831),
  ('2026-07-08', 82849),
  ('2026-07-09', 79855),
  ('2026-07-10', 139746),
  ('2026-07-11', 137750),
  ('2026-07-12', 78857),
  ('2026-07-13', 92831),
  ('2026-07-15', 82849),
  ('2026-07-16', 79855),
  ('2026-07-17', 139746),
  ('2026-07-18', 137750),
  ('2026-07-19', 78857),
  ('2026-07-20', 92831),
  ('2026-07-22', 82849),
  ('2026-07-23', 79855),
  ('2026-07-24', 139746),
  ('2026-07-25', 137750),
  ('2026-07-26', 78857),
  ('2026-07-27', 92831),
  ('2026-07-29', 82849),
  ('2026-07-30', 79855),
  ('2026-07-31', 139746),
  ('2026-08-01', 155887),
  ('2026-08-02', 89240),
  ('2026-08-03', 105054),
  ('2026-08-05', 93758),
  ('2026-08-06', 90369),
  ('2026-08-07', 158146),
  ('2026-08-08', 155887),
  ('2026-08-09', 89240),
  ('2026-08-10', 105054),
  ('2026-08-12', 93758),
  ('2026-08-13', 90369),
  ('2026-08-14', 158146),
  ('2026-08-15', 155887),
  ('2026-08-16', 89240),
  ('2026-08-17', 105054),
  ('2026-08-19', 93758),
  ('2026-08-20', 90369),
  ('2026-08-21', 158146),
  ('2026-08-22', 155887),
  ('2026-08-23', 89240),
  ('2026-08-24', 105054),
  ('2026-08-26', 93758),
  ('2026-08-27', 90369),
  ('2026-08-28', 158146),
  ('2026-08-29', 155887),
  ('2026-08-30', 89240),
  ('2026-08-31', 105054),
  ('2026-09-02', 91022),
  ('2026-09-03', 87732),
  ('2026-09-04', 153531),
  ('2026-09-05', 151337),
  ('2026-09-06', 86635),
  ('2026-09-07', 101988),
  ('2026-09-09', 91022),
  ('2026-09-10', 87732),
  ('2026-09-11', 153531),
  ('2026-09-12', 151337),
  ('2026-09-13', 86635),
  ('2026-09-14', 101988),
  ('2026-09-16', 91022),
  ('2026-09-17', 87732),
  ('2026-09-18', 153531),
  ('2026-09-19', 151337),
  ('2026-09-20', 86635),
  ('2026-09-21', 101988),
  ('2026-09-23', 91022),
  ('2026-09-24', 87732),
  ('2026-09-25', 153531),
  ('2026-09-26', 151337),
  ('2026-09-27', 86635),
  ('2026-09-28', 101988),
  ('2026-09-30', 91022),
  ('2026-10-01', 60071),
  ('2026-10-02', 105125),
  ('2026-10-03', 103623),
  ('2026-10-04', 59320),
  ('2026-10-05', 69833),
  ('2026-10-07', 62324),
  ('2026-10-08', 60071),
  ('2026-10-09', 105125),
  ('2026-10-10', 103623),
  ('2026-10-11', 59320),
  ('2026-10-12', 69833),
  ('2026-10-14', 62324),
  ('2026-10-15', 60071),
  ('2026-10-16', 105125),
  ('2026-10-17', 103623),
  ('2026-10-18', 59320),
  ('2026-10-19', 69833),
  ('2026-10-21', 62324),
  ('2026-10-22', 60071),
  ('2026-10-23', 105125),
  ('2026-10-24', 103623),
  ('2026-10-25', 59320),
  ('2026-10-26', 69833),
  ('2026-10-28', 62324),
  ('2026-10-29', 60071),
  ('2026-10-30', 105125),
  ('2026-10-31', 103623),
  ('2026-11-01', 85503),
  ('2026-11-02', 100655),
  ('2026-11-04', 89832),
  ('2026-11-05', 86585),
  ('2026-11-06', 151524),
  ('2026-11-07', 149360),
  ('2026-11-08', 85503),
  ('2026-11-09', 100655),
  ('2026-11-11', 89832),
  ('2026-11-12', 86585),
  ('2026-11-13', 151524),
  ('2026-11-14', 149360),
  ('2026-11-15', 85503),
  ('2026-11-16', 100655),
  ('2026-11-18', 89832),
  ('2026-11-19', 86585),
  ('2026-11-20', 151524),
  ('2026-11-21', 149360),
  ('2026-11-22', 85503),
  ('2026-11-23', 100655),
  ('2026-11-25', 89832),
  ('2026-11-26', 86585),
  ('2026-11-27', 151524),
  ('2026-11-28', 149360),
  ('2026-11-29', 85503),
  ('2026-11-30', 100655),
  ('2026-12-02', 93315),
  ('2026-12-03', 89943),
  ('2026-12-04', 157400),
  ('2026-12-05', 155151),
  ('2026-12-06', 88818),
  ('2026-12-07', 104558),
  ('2026-12-09', 93315),
  ('2026-12-10', 89943),
  ('2026-12-11', 157400),
  ('2026-12-12', 155151),
  ('2026-12-13', 88818),
  ('2026-12-14', 104558),
  ('2026-12-16', 93315),
  ('2026-12-17', 89943),
  ('2026-12-18', 157400),
  ('2026-12-19', 155151),
  ('2026-12-20', 88818),
  ('2026-12-21', 104558),
  ('2026-12-23', 93315),
  ('2026-12-24', 89943),
  ('2026-12-25', 157400),
  ('2026-12-26', 155151),
  ('2026-12-27', 88818),
  ('2026-12-28', 104558),
  ('2026-12-30', 93315),
  ('2026-12-31', 89943)
on conflict (biz_date) do update set
  target_yen = excluded.target_yen,
  updated_at = now();


-- ════════ 0020_sales_monthly.sql ════════

-- 0020 月間売上目標（店主フィードバック 2026-08-08 その16）
--
-- 月間の目標は「日毎の合計（曜日指数配分の丸めで端数が出る）」ではなく、
-- 店主が決めた端数なしの数字を正とする（8月なら ¥3,120,000）。
-- 達成率・「あと◯円」の計算もこの数字がベース。

create table if not exists sales_monthly (
  ym         text primary key check (ym ~ '^[0-9]{4}-[0-9]{2}$'),
  target_yen integer not null check (target_yen >= 0),
  updated_at timestamptz not null default now()
);

alter table sales_monthly enable row level security;
revoke all on sales_monthly from anon;
-- 読み取りは全員。値の追加・変更はマイグレーション（deploy）で行う。
grant select on sales_monthly to authenticated;

drop policy if exists sales_monthly_select on sales_monthly;
create policy sales_monthly_select on sales_monthly
  for select to authenticated using (is_active_user());

-- 店主提供PDFの月間目標（2026年6月〜12月）
insert into sales_monthly (ym, target_yen) values
  ('2026-06', 2690000),
  ('2026-07', 2750000),
  ('2026-08', 3120000),
  ('2026-09', 2780000),
  ('2026-10', 2110000),
  ('2026-11', 2840000),
  ('2026-12', 2940000)
on conflict (ym) do update set target_yen = excluded.target_yen, updated_at = now();
