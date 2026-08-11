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
-- 0021 ネット予約（HP公開フォーム）
--
-- お客様向けの予約はこの関数だけが書き込む。判定と登録を1トランザクションで行い、
-- 同じ営業日への同時送信は advisory lock で直列化する。
-- 「画面では空いて見えたのに、押した瞬間に別の人が取っていた」場合はエラーで返り、
-- 席の二重予約はDBの中で構造的に起きない。
--
-- 実行権限は service_role のみ（アプリのサーバーAPIからだけ呼べる。ブラウザから直接は呼べない）。

create or replace function public.net_reserve(
  p_date      date,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_party     integer,
  p_name      text,
  p_kana      text,
  p_phone     text,
  p_memo      text,
  p_seat_note text
) returns table (id uuid, reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day    business_days%rowtype;
  v_cap    integer;
  v_guests integer;
  v_unit   seat_units%rowtype;
  v_used   integer;
begin
  if p_party is null or p_party < 1 or p_party > 8 then
    raise exception 'NET_PARTY';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'NET_NAME';
  end if;

  -- 同じ営業日の判定を直列化する（別の日どうしは並行してよい）
  perform pg_advisory_xact_lock(hashtext('net-reserve-' || p_date::text));

  select * into v_day from business_days where biz_date = p_date;

  if found and v_day.is_closed then
    raise exception 'NET_CLOSED';
  end if;

  if found and v_day.mode = 'event' then
    -- イベント営業は席を持たず定員で見る
    v_cap := coalesce(v_day.event_capacity, 36);
    select coalesce(sum(party_size), 0) into v_guests
      from reservations
     where biz_date = p_date and status in ('tentative', 'confirmed', 'seated');
    if v_guests + p_party > v_cap then
      raise exception 'NET_FULL';
    end if;
  elsif p_seat_note is not null and p_seat_note <> '指定なし' then
    select * into v_unit from seat_units where name = p_seat_note and is_active;
    if not found then
      raise exception 'NET_SEAT_UNKNOWN';
    end if;
    if v_unit.is_shared then
      -- カウンター：残席で見る
      select coalesce(sum(party_size), 0) into v_used
        from reservations
       where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
         and seat_note is not null
         and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'));
      if v_used + p_party > v_unit.capacity then
        raise exception 'NET_FULL';
      end if;
    else
      -- テーブル・和室：1晩1組（アプリ側と同じ判定）
      if exists (
        select 1 from reservations
         where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
           and seat_note is not null
           and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'))
      ) then
        raise exception 'NET_FULL';
      end if;
    end if;
  end if;

  return query
  insert into reservations
    (biz_date, starts_at, ends_at, party_size, customer_name, customer_kana, phone,
     source, source_detail, status, seat_note, memo)
  values
    (p_date, p_starts_at, p_ends_at, p_party, btrim(p_name), nullif(btrim(coalesce(p_kana, '')), ''),
     p_phone, 'web_form', 'ネット予約', 'confirmed', p_seat_note,
     nullif(btrim(coalesce(p_memo, '')), ''))
  returning reservations.id, reservations.reference;
end;
$$;

revoke all on function public.net_reserve(date, timestamptz, timestamptz, integer, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.net_reserve(date, timestamptz, timestamptz, integer, text, text, text, text, text)
  to service_role;
-- 0022 ネット予約の席選択と繁忙日ルール
--
-- お客様が席を選べるようになったため、最後の砦（net_reserve）にも
-- 店のルールを追加する：繁忙日の3名様以下はカウンターのみ。
-- 画面やAPIをすり抜けた直接POSTでも、このルールはDBの中で必ず効く。

create or replace function public.net_reserve(
  p_date      date,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_party     integer,
  p_name      text,
  p_kana      text,
  p_phone     text,
  p_memo      text,
  p_seat_note text
) returns table (id uuid, reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day    business_days%rowtype;
  v_cap    integer;
  v_guests integer;
  v_unit   seat_units%rowtype;
  v_used   integer;
begin
  if p_party is null or p_party < 1 or p_party > 8 then
    raise exception 'NET_PARTY';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'NET_NAME';
  end if;

  -- 同じ営業日の判定を直列化する（別の日どうしは並行してよい）
  perform pg_advisory_xact_lock(hashtext('net-reserve-' || p_date::text));

  select * into v_day from business_days where biz_date = p_date;

  if found and v_day.is_closed then
    raise exception 'NET_CLOSED';
  end if;

  if found and v_day.mode = 'event' then
    -- イベント営業は席を持たず定員で見る
    v_cap := coalesce(v_day.event_capacity, 36);
    select coalesce(sum(party_size), 0) into v_guests
      from reservations
     where biz_date = p_date and status in ('tentative', 'confirmed', 'seated');
    if v_guests + p_party > v_cap then
      raise exception 'NET_FULL';
    end if;
  elsif p_seat_note is not null and p_seat_note <> '指定なし' then
    select * into v_unit from seat_units where name = p_seat_note and is_active;
    if not found then
      raise exception 'NET_SEAT_UNKNOWN';
    end if;
    -- 繁忙日の3名様以下はカウンターのみ（店のルール。ネットからは例外なし）
    if coalesce(v_day.is_busy, false) and p_party <= 3 and not v_unit.is_shared then
      raise exception 'NET_BUSY_RULE';
    end if;
    if v_unit.is_shared then
      -- カウンター：残席で見る
      select coalesce(sum(party_size), 0) into v_used
        from reservations
       where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
         and seat_note is not null
         and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'));
      if v_used + p_party > v_unit.capacity then
        raise exception 'NET_FULL';
      end if;
    else
      -- テーブル・和室：1晩1組（アプリ側と同じ判定）
      if exists (
        select 1 from reservations
         where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
           and seat_note is not null
           and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'))
      ) then
        raise exception 'NET_FULL';
      end if;
    end if;
  end if;

  return query
  insert into reservations
    (biz_date, starts_at, ends_at, party_size, customer_name, customer_kana, phone,
     source, source_detail, status, seat_note, memo)
  values
    (p_date, p_starts_at, p_ends_at, p_party, btrim(p_name), nullif(btrim(coalesce(p_kana, '')), ''),
     p_phone, 'web_form', 'ネット予約', 'confirmed', p_seat_note,
     nullif(btrim(coalesce(p_memo, '')), ''))
  returning reservations.id, reservations.reference;
end;
$$;
-- 0023 ネット予約：金曜・土曜は自動的に繁忙日ルールを適用する
--
-- 繁忙日フラグ（business_days.is_busy）は店長の手動設定だが、金土は混むのが常なので
-- ネット予約に限っては自動で繁忙日扱いにする（3名様以下はカウンターのみ）。
-- 手動フラグは平日のイベント日などに引き続き使える（OR で効く）。

create or replace function public.net_reserve(
  p_date      date,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_party     integer,
  p_name      text,
  p_kana      text,
  p_phone     text,
  p_memo      text,
  p_seat_note text
) returns table (id uuid, reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day    business_days%rowtype;
  v_busy   boolean;
  v_cap    integer;
  v_guests integer;
  v_unit   seat_units%rowtype;
  v_used   integer;
begin
  if p_party is null or p_party < 1 or p_party > 8 then
    raise exception 'NET_PARTY';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'NET_NAME';
  end if;

  -- 同じ営業日の判定を直列化する（別の日どうしは並行してよい）
  perform pg_advisory_xact_lock(hashtext('net-reserve-' || p_date::text));

  select * into v_day from business_days where biz_date = p_date;

  if found and v_day.is_closed then
    raise exception 'NET_CLOSED';
  end if;

  -- 金(5)・土(6)は自動で繁忙日扱い。手動フラグとORで効く
  v_busy := coalesce(v_day.is_busy, false) or extract(dow from p_date) in (5, 6);

  if found and v_day.mode = 'event' then
    -- イベント営業は席を持たず定員で見る
    v_cap := coalesce(v_day.event_capacity, 36);
    select coalesce(sum(party_size), 0) into v_guests
      from reservations
     where biz_date = p_date and status in ('tentative', 'confirmed', 'seated');
    if v_guests + p_party > v_cap then
      raise exception 'NET_FULL';
    end if;
  elsif p_seat_note is not null and p_seat_note <> '指定なし' then
    select * into v_unit from seat_units where name = p_seat_note and is_active;
    if not found then
      raise exception 'NET_SEAT_UNKNOWN';
    end if;
    -- 繁忙日の3名様以下はカウンターのみ（店のルール。ネットからは例外なし）
    if v_busy and p_party <= 3 and not v_unit.is_shared then
      raise exception 'NET_BUSY_RULE';
    end if;
    if v_unit.is_shared then
      -- カウンター：残席で見る
      select coalesce(sum(party_size), 0) into v_used
        from reservations
       where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
         and seat_note is not null
         and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'));
      if v_used + p_party > v_unit.capacity then
        raise exception 'NET_FULL';
      end if;
    else
      -- テーブル・和室：1晩1組（アプリ側と同じ判定）
      if exists (
        select 1 from reservations
         where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
           and seat_note is not null
           and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'))
      ) then
        raise exception 'NET_FULL';
      end if;
    end if;
  end if;

  return query
  insert into reservations
    (biz_date, starts_at, ends_at, party_size, customer_name, customer_kana, phone,
     source, source_detail, status, seat_note, memo)
  values
    (p_date, p_starts_at, p_ends_at, p_party, btrim(p_name), nullif(btrim(coalesce(p_kana, '')), ''),
     p_phone, 'web_form', 'ネット予約', 'confirmed', p_seat_note,
     nullif(btrim(coalesce(p_memo, '')), ''))
  returning reservations.id, reservations.reference;
end;
$$;
-- 0024 金曜・土曜はデフォルトで繁忙日（店主指定）
--
-- 「繁忙日」を金土の既定値にする。店長は営業日の設定で個別にオフにできる
-- （行の is_busy=false を保存すれば、その日はネット予約もアプリも通常扱いに戻る）。
--
-- 1) 行の自動作成（ensure_business_day）で金土は is_busy=true で作る
-- 2) 既存の未来の金土の行を is_busy=true に更新
-- 3) net_reserve は「行があればその値・無ければ曜日から導出」に変更
--    （0023の「無条件OR」だと店長がオフにしても効かないため）

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

  insert into business_days (biz_date, mode, is_closed, open_min, close_min, is_busy)
  values (d, 'normal', closed, 1080, cmin, dow in (5, 6))    -- 金土は繁忙日で作る
  on conflict (biz_date) do nothing;

  select * into row from business_days where biz_date = d;
  return row;
end;
$$;

-- 既存の未来の金土を繁忙日に（過去は触らない）
update business_days
   set is_busy = true
 where extract(dow from biz_date) in (5, 6)
   and biz_date >= current_date
   and not is_busy;

create or replace function public.net_reserve(
  p_date      date,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_party     integer,
  p_name      text,
  p_kana      text,
  p_phone     text,
  p_memo      text,
  p_seat_note text
) returns table (id uuid, reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day    business_days%rowtype;
  v_found  boolean;
  v_busy   boolean;
  v_cap    integer;
  v_guests integer;
  v_unit   seat_units%rowtype;
  v_used   integer;
begin
  if p_party is null or p_party < 1 or p_party > 8 then
    raise exception 'NET_PARTY';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'NET_NAME';
  end if;

  -- 同じ営業日の判定を直列化する（別の日どうしは並行してよい）
  perform pg_advisory_xact_lock(hashtext('net-reserve-' || p_date::text));

  select * into v_day from business_days where biz_date = p_date;
  v_found := found;

  if v_found and v_day.is_closed then
    raise exception 'NET_CLOSED';
  end if;

  -- 行があれば店長の設定を尊重。無ければ金土を繁忙日として導出
  v_busy := case when v_found then v_day.is_busy
                 else extract(dow from p_date) in (5, 6) end;

  if v_found and v_day.mode = 'event' then
    -- イベント営業は席を持たず定員で見る
    v_cap := coalesce(v_day.event_capacity, 36);
    select coalesce(sum(party_size), 0) into v_guests
      from reservations
     where biz_date = p_date and status in ('tentative', 'confirmed', 'seated');
    if v_guests + p_party > v_cap then
      raise exception 'NET_FULL';
    end if;
  elsif p_seat_note is not null and p_seat_note <> '指定なし' then
    select * into v_unit from seat_units where name = p_seat_note and is_active;
    if not found then
      raise exception 'NET_SEAT_UNKNOWN';
    end if;
    -- 繁忙日の3名様以下はカウンターのみ（店のルール。ネットからは例外なし）
    if v_busy and p_party <= 3 and not v_unit.is_shared then
      raise exception 'NET_BUSY_RULE';
    end if;
    if v_unit.is_shared then
      -- カウンター：残席で見る
      select coalesce(sum(party_size), 0) into v_used
        from reservations
       where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
         and seat_note is not null
         and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'));
      if v_used + p_party > v_unit.capacity then
        raise exception 'NET_FULL';
      end if;
    else
      -- テーブル・和室：1晩1組（アプリ側と同じ判定）
      if exists (
        select 1 from reservations
         where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
           and seat_note is not null
           and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'))
      ) then
        raise exception 'NET_FULL';
      end if;
    end if;
  end if;

  return query
  insert into reservations
    (biz_date, starts_at, ends_at, party_size, customer_name, customer_kana, phone,
     source, source_detail, status, seat_note, memo)
  values
    (p_date, p_starts_at, p_ends_at, p_party, btrim(p_name), nullif(btrim(coalesce(p_kana, '')), ''),
     p_phone, 'web_form', 'ネット予約', 'confirmed', p_seat_note,
     nullif(btrim(coalesce(p_memo, '')), ''))
  returning reservations.id, reservations.reference;
end;
$$;
-- 0025 席ボード（タブレット常設・飛び込みのリアルタイム管理）
--
-- 「実際は飛び込みで埋まっている席」を、レジ横のタブレットからワンタップで記録する。
-- ネット予約の空席判定は「予約データ ＋ 席ボード」の両方が空いているときだけ◯になる。
-- 行は営業日(biz_date)ごとに持つ＝日付が変われば自動的にまっさら（昨日の残り事故なし）。

create table if not exists seat_board (
  biz_date   date not null,
  -- 'T1' 'T2' 'T3' '和室' はその卓が使用中か(0/1)。'C' はカウンターの使用席数(0〜10)
  key        text not null,
  occupied   integer not null default 0 check (occupied between 0 and 10),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  primary key (biz_date, key)
);

alter table seat_board enable row level security;

do $$ begin
  create policy seat_board_read on seat_board for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- 書き込みはこの関数だけ（テーブル直書きはRLSで不可）
create or replace function public.set_seat_board(p_date date, p_key text, p_value integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if p_key not in ('T1', 'T2', 'T3', '和室', 'C') then
    raise exception '席の指定が不正です';
  end if;
  if p_value is null or p_value < 0 or p_value > 10 then
    raise exception '値が不正です';
  end if;
  if p_key <> 'C' and p_value > 1 then
    raise exception '卓は0か1です';
  end if;

  insert into seat_board (biz_date, key, occupied, updated_by)
  values (p_date, p_key, p_value, auth.uid())
  on conflict (biz_date, key)
  do update set occupied = excluded.occupied, updated_by = auth.uid(), updated_at = now();
end;
$$;

grant execute on function public.set_seat_board(date, text, integer) to authenticated;

-- ネット予約の最後の砦にも席ボードを見せる：
-- 「予約は無いが飛び込みで埋まっている席」への確定を防ぐ
create or replace function public.net_reserve(
  p_date      date,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_party     integer,
  p_name      text,
  p_kana      text,
  p_phone     text,
  p_memo      text,
  p_seat_note text
) returns table (id uuid, reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day    business_days%rowtype;
  v_found  boolean;
  v_busy   boolean;
  v_cap    integer;
  v_guests integer;
  v_unit   seat_units%rowtype;
  v_used   integer;
begin
  if p_party is null or p_party < 1 or p_party > 8 then
    raise exception 'NET_PARTY';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'NET_NAME';
  end if;

  perform pg_advisory_xact_lock(hashtext('net-reserve-' || p_date::text));

  select * into v_day from business_days where biz_date = p_date;
  v_found := found;

  if v_found and v_day.is_closed then
    raise exception 'NET_CLOSED';
  end if;

  v_busy := case when v_found then v_day.is_busy
                 else extract(dow from p_date) in (5, 6) end;

  if v_found and v_day.mode = 'event' then
    v_cap := coalesce(v_day.event_capacity, 36);
    select coalesce(sum(party_size), 0) into v_guests
      from reservations
     where biz_date = p_date and status in ('tentative', 'confirmed', 'seated');
    if v_guests + p_party > v_cap then
      raise exception 'NET_FULL';
    end if;
  elsif p_seat_note is not null and p_seat_note <> '指定なし' then
    select * into v_unit from seat_units where name = p_seat_note and is_active;
    if not found then
      raise exception 'NET_SEAT_UNKNOWN';
    end if;
    if v_busy and p_party <= 3 and not v_unit.is_shared then
      raise exception 'NET_BUSY_RULE';
    end if;
    if v_unit.is_shared then
      select coalesce(sum(party_size), 0) into v_used
        from reservations
       where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
         and seat_note is not null
         and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'));
      -- 席ボード（飛び込み）は予約と重なっている可能性があるので大きい方を採る
      v_used := greatest(v_used, coalesce(
        (select occupied from seat_board where biz_date = p_date and key = 'C'), 0));
      if v_used + p_party > v_unit.capacity then
        raise exception 'NET_FULL';
      end if;
    else
      if exists (
        select 1 from reservations
         where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
           and seat_note is not null
           and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'))
      ) or exists (
        select 1 from seat_board
         where biz_date = p_date and key = p_seat_note and occupied > 0
      ) then
        raise exception 'NET_FULL';
      end if;
    end if;
  end if;

  return query
  insert into reservations
    (biz_date, starts_at, ends_at, party_size, customer_name, customer_kana, phone,
     source, source_detail, status, seat_note, memo)
  values
    (p_date, p_starts_at, p_ends_at, p_party, btrim(p_name), nullif(btrim(coalesce(p_kana, '')), ''),
     p_phone, 'web_form', 'ネット予約', 'confirmed', p_seat_note,
     nullif(btrim(coalesce(p_memo, '')), ''))
  returning reservations.id, reservations.reference;
end;
$$;

-- 0026 席ボード：カウンター1席ずつ（C1〜C10）
-- 0026 席ボード：カウンターを1席ずつ管理できるようにする
--
-- タブレットのボードを実店舗の配置（L型カウンター）に合わせ、
-- 丸椅子を1席ずつタップで記録する方式へ。キーは 'C1'〜'C10'（0/1）。
-- 旧方式の 'C'（使用席数の合計）も互換のため残し、空席判定は
-- 「予約」「C」「C1〜C10の合計」のいちばん大きい値を採る。

create or replace function public.set_seat_board(p_date date, p_key text, p_value integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if p_key not in ('T1', 'T2', 'T3', '和室', 'C',
                   'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10') then
    raise exception '席の指定が不正です';
  end if;
  if p_value is null or p_value < 0 or p_value > 10 then
    raise exception '値が不正です';
  end if;
  if p_key <> 'C' and p_value > 1 then
    raise exception '席は0か1です';
  end if;

  insert into seat_board (biz_date, key, occupied, updated_by)
  values (p_date, p_key, p_value, auth.uid())
  on conflict (biz_date, key)
  do update set occupied = excluded.occupied, updated_by = auth.uid(), updated_at = now();
end;
$$;

create or replace function public.net_reserve(
  p_date      date,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_party     integer,
  p_name      text,
  p_kana      text,
  p_phone     text,
  p_memo      text,
  p_seat_note text
) returns table (id uuid, reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day    business_days%rowtype;
  v_found  boolean;
  v_busy   boolean;
  v_cap    integer;
  v_guests integer;
  v_unit   seat_units%rowtype;
  v_used   integer;
begin
  if p_party is null or p_party < 1 or p_party > 8 then
    raise exception 'NET_PARTY';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'NET_NAME';
  end if;

  perform pg_advisory_xact_lock(hashtext('net-reserve-' || p_date::text));

  select * into v_day from business_days where biz_date = p_date;
  v_found := found;

  if v_found and v_day.is_closed then
    raise exception 'NET_CLOSED';
  end if;

  v_busy := case when v_found then v_day.is_busy
                 else extract(dow from p_date) in (5, 6) end;

  if v_found and v_day.mode = 'event' then
    v_cap := coalesce(v_day.event_capacity, 36);
    select coalesce(sum(party_size), 0) into v_guests
      from reservations
     where biz_date = p_date and status in ('tentative', 'confirmed', 'seated');
    if v_guests + p_party > v_cap then
      raise exception 'NET_FULL';
    end if;
  elsif p_seat_note is not null and p_seat_note <> '指定なし' then
    select * into v_unit from seat_units where name = p_seat_note and is_active;
    if not found then
      raise exception 'NET_SEAT_UNKNOWN';
    end if;
    if v_busy and p_party <= 3 and not v_unit.is_shared then
      raise exception 'NET_BUSY_RULE';
    end if;
    if v_unit.is_shared then
      select coalesce(sum(party_size), 0) into v_used
        from reservations
       where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
         and seat_note is not null
         and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'));
      -- 席ボード（飛び込み）は予約と重なっている可能性があるので大きい方を採る。
      -- 旧'C'（合計値）と 'C1'〜'C10'（1席ずつ）の両方式に対応
      v_used := greatest(
        v_used,
        coalesce((select occupied from seat_board where biz_date = p_date and key = 'C'), 0),
        coalesce((select sum(occupied) from seat_board
                   where biz_date = p_date and key ~ '^C[0-9]+$'), 0));
      if v_used + p_party > v_unit.capacity then
        raise exception 'NET_FULL';
      end if;
    else
      if exists (
        select 1 from reservations
         where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
           and seat_note is not null
           and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'))
      ) or exists (
        select 1 from seat_board
         where biz_date = p_date and key = p_seat_note and occupied > 0
      ) then
        raise exception 'NET_FULL';
      end if;
    end if;
  end if;

  return query
  insert into reservations
    (biz_date, starts_at, ends_at, party_size, customer_name, customer_kana, phone,
     source, source_detail, status, seat_note, memo)
  values
    (p_date, p_starts_at, p_ends_at, p_party, btrim(p_name), nullif(btrim(coalesce(p_kana, '')), ''),
     p_phone, 'web_form', 'ネット予約', 'confirmed', p_seat_note,
     nullif(btrim(coalesce(p_memo, '')), ''))
  returning reservations.id, reservations.reference;
end;
$$;

-- 0027 ネット予約の一時停止（当日分のみ・記録つき）
-- 0027 ネット予約の一時停止（とても忙しい日に、現場から当日分だけ止める）
--
-- 席ボードの「新規予約停止」を押すと、その営業日のネット予約だけが止まる。
-- 翌日以降の予約はいつもどおり受け付ける（機会損失を最小にするため）。
--
-- 止めた時刻と再開した時刻は必ず1行として残す。これは記録のためであると同時に、
-- 「止めっぱなしにすると月の合計時間として見える」という抑止のためでもある。

create table if not exists net_pause (
  id         uuid primary key default gen_random_uuid(),
  biz_date   date not null,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  started_by uuid references profiles(id),
  ended_by   uuid references profiles(id)
);

-- 同じ営業日に「開いたままの停止」は1つだけ
create unique index if not exists net_pause_one_open
  on net_pause (biz_date) where ended_at is null;

create index if not exists net_pause_biz_date on net_pause (biz_date);

alter table net_pause enable row level security;

do $$ begin
  create policy net_pause_read on net_pause for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- 書き込みはこの関数だけ。現場の誰でも押せる（忙しい最中に権限で迷わせない）
create or replace function public.set_net_pause(p_date date, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;

  if p_on then
    -- 既に止まっているなら二重に記録しない
    insert into net_pause (biz_date, started_by)
    select p_date, auth.uid()
     where not exists (
       select 1 from net_pause where biz_date = p_date and ended_at is null
     );
  else
    update net_pause
       set ended_at = now(), ended_by = auth.uid()
     where biz_date = p_date and ended_at is null;
  end if;
end;
$$;

grant execute on function public.set_net_pause(date, boolean) to authenticated;

-- 最後の砦にも停止を見せる：止めている間はその日の登録を通さない
create or replace function public.net_reserve(
  p_date      date,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_party     integer,
  p_name      text,
  p_kana      text,
  p_phone     text,
  p_memo      text,
  p_seat_note text
) returns table (id uuid, reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day    business_days%rowtype;
  v_found  boolean;
  v_busy   boolean;
  v_cap    integer;
  v_guests integer;
  v_unit   seat_units%rowtype;
  v_used   integer;
begin
  if p_party is null or p_party < 1 or p_party > 8 then
    raise exception 'NET_PARTY';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'NET_NAME';
  end if;

  perform pg_advisory_xact_lock(hashtext('net-reserve-' || p_date::text));

  -- 現場が受付を止めている日
  if exists (select 1 from net_pause where biz_date = p_date and ended_at is null) then
    raise exception 'NET_PAUSED';
  end if;

  select * into v_day from business_days where biz_date = p_date;
  v_found := found;

  if v_found and v_day.is_closed then
    raise exception 'NET_CLOSED';
  end if;

  v_busy := case when v_found then v_day.is_busy
                 else extract(dow from p_date) in (5, 6) end;

  if v_found and v_day.mode = 'event' then
    v_cap := coalesce(v_day.event_capacity, 36);
    select coalesce(sum(party_size), 0) into v_guests
      from reservations
     where biz_date = p_date and status in ('tentative', 'confirmed', 'seated');
    if v_guests + p_party > v_cap then
      raise exception 'NET_FULL';
    end if;
  elsif p_seat_note is not null and p_seat_note <> '指定なし' then
    select * into v_unit from seat_units where name = p_seat_note and is_active;
    if not found then
      raise exception 'NET_SEAT_UNKNOWN';
    end if;
    if v_busy and p_party <= 3 and not v_unit.is_shared then
      raise exception 'NET_BUSY_RULE';
    end if;
    if v_unit.is_shared then
      select coalesce(sum(party_size), 0) into v_used
        from reservations
       where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
         and seat_note is not null
         and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'));
      -- 席ボード（飛び込み）は予約と重なっている可能性があるので大きい方を採る。
      -- 旧'C'（合計値）と 'C1'〜'C10'（1席ずつ）の両方式に対応
      v_used := greatest(
        v_used,
        coalesce((select occupied from seat_board where biz_date = p_date and key = 'C'), 0),
        coalesce((select sum(occupied) from seat_board
                   where biz_date = p_date and key ~ '^C[0-9]+$'), 0));
      if v_used + p_party > v_unit.capacity then
        raise exception 'NET_FULL';
      end if;
    else
      if exists (
        select 1 from reservations
         where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
           and seat_note is not null
           and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'))
      ) or exists (
        select 1 from seat_board
         where biz_date = p_date and key = p_seat_note and occupied > 0
      ) then
        raise exception 'NET_FULL';
      end if;
    end if;
  end if;

  return query
  insert into reservations
    (biz_date, starts_at, ends_at, party_size, customer_name, customer_kana, phone,
     source, source_detail, status, seat_note, memo)
  values
    (p_date, p_starts_at, p_ends_at, p_party, btrim(p_name), nullif(btrim(coalesce(p_kana, '')), ''),
     p_phone, 'web_form', 'ネット予約', 'confirmed', p_seat_note,
     nullif(btrim(coalesce(p_memo, '')), ''))
  returning reservations.id, reservations.reference;
end;
$$;

-- 0028 イベント営業のチラシと当日締切
-- 0028 イベント営業のチラシと、当日ネット予約の締切
--
-- イベント営業は通常営業とメニューも価格も違う。お客様が知らずに予約して
-- 「思っていたのと違う」となるのを防ぐため、
--   ・イベント日はチラシ（画像/PDF）の登録を必須にする
--   ・予約ページでチラシを見せ、了承のチェックを取る
--   ・準備の都合もあるので、ネット予約は前日までで締め切る
-- という3点を仕組みとして持たせる。

alter table business_days add column if not exists flyer_url text;

comment on column business_days.flyer_url is
  'イベント営業のチラシ（画像またはPDF）の公開URL。イベント日は必須。';

-- チラシの置き場所。公開バケット（予約ページのお客様が見るため）
insert into storage.buckets (id, name, public)
values ('flyers', 'flyers', true)
on conflict (id) do update set public = true;

do $$ begin
  create policy flyers_public_read on storage.objects
    for select using (bucket_id = 'flyers');
exception when duplicate_object then null; end $$;

-- 最後の砦：イベント日の当日ネット予約は通さない（前日まで）
create or replace function public.net_reserve(
  p_date      date,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_party     integer,
  p_name      text,
  p_kana      text,
  p_phone     text,
  p_memo      text,
  p_seat_note text
) returns table (id uuid, reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day    business_days%rowtype;
  v_found  boolean;
  v_busy   boolean;
  v_cap    integer;
  v_guests integer;
  v_unit   seat_units%rowtype;
  v_used   integer;
  v_today  date;
begin
  if p_party is null or p_party < 1 or p_party > 8 then
    raise exception 'NET_PARTY';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'NET_NAME';
  end if;

  perform pg_advisory_xact_lock(hashtext('net-reserve-' || p_date::text));

  -- 現場が受付を止めている日
  if exists (select 1 from net_pause where biz_date = p_date and ended_at is null) then
    raise exception 'NET_PAUSED';
  end if;

  -- 営業日は朝4時で切り替わる（深夜1時はまだ前日の営業）
  v_today := ((now() at time zone 'Asia/Tokyo') - interval '4 hours')::date;

  select * into v_day from business_days where biz_date = p_date;
  v_found := found;

  if v_found and v_day.is_closed then
    raise exception 'NET_CLOSED';
  end if;

  -- イベント営業のネット予約は前日まで
  if v_found and v_day.mode = 'event' and p_date <= v_today then
    raise exception 'NET_EVENT_TODAY';
  end if;

  v_busy := case when v_found then v_day.is_busy
                 else extract(dow from p_date) in (5, 6) end;

  if v_found and v_day.mode = 'event' then
    v_cap := coalesce(v_day.event_capacity, 36);
    select coalesce(sum(party_size), 0) into v_guests
      from reservations
     where biz_date = p_date and status in ('tentative', 'confirmed', 'seated');
    if v_guests + p_party > v_cap then
      raise exception 'NET_FULL';
    end if;
  elsif p_seat_note is not null and p_seat_note <> '指定なし' then
    select * into v_unit from seat_units where name = p_seat_note and is_active;
    if not found then
      raise exception 'NET_SEAT_UNKNOWN';
    end if;
    if v_busy and p_party <= 3 and not v_unit.is_shared then
      raise exception 'NET_BUSY_RULE';
    end if;
    if v_unit.is_shared then
      select coalesce(sum(party_size), 0) into v_used
        from reservations
       where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
         and seat_note is not null
         and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'));
      v_used := greatest(
        v_used,
        coalesce((select occupied from seat_board where biz_date = p_date and key = 'C'), 0),
        coalesce((select sum(occupied) from seat_board
                   where biz_date = p_date and key ~ '^C[0-9]+$'), 0));
      if v_used + p_party > v_unit.capacity then
        raise exception 'NET_FULL';
      end if;
    else
      if exists (
        select 1 from reservations
         where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
           and seat_note is not null
           and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'))
      ) or exists (
        select 1 from seat_board
         where biz_date = p_date and key = p_seat_note and occupied > 0
      ) then
        raise exception 'NET_FULL';
      end if;
    end if;
  end if;

  return query
  insert into reservations
    (biz_date, starts_at, ends_at, party_size, customer_name, customer_kana, phone,
     source, source_detail, status, seat_note, memo)
  values
    (p_date, p_starts_at, p_ends_at, p_party, btrim(p_name), nullif(btrim(coalesce(p_kana, '')), ''),
     p_phone, 'web_form', 'ネット予約', 'confirmed', p_seat_note,
     nullif(btrim(coalesce(p_memo, '')), ''))
  returning reservations.id, reservations.reference;
end;
$$;

-- 0029 席を1席ずつ記録し、着席・退席を履歴として残す
-- 0029 席を1席ずつ記録し、着席・退席を履歴として残す
--
-- これまで席ボードは「いま埋まっているか」しか持っていなかった（上書きなので履歴が消える）。
-- 客席稼働率や時間帯別の滞在時間を後から見られるように、タップのたびに
-- 「座った時刻・立った時刻」を1行として積み上げる。
--
-- あわせて、テーブルと和室も卓ごとではなく席ごとに扱う。
-- ただし**予約の空席判定は今までどおり「1席でも埋まっていればその卓は満席」**（店主指定）。
--
-- いちばん危険なのは、キーの体系を変えた瞬間に空席判定が
-- 「埋まっている卓を空きと誤認する」ことなので、
-- 席キー → 卓名 の対応表（seat_slots）をDBに1つだけ置き、判定はすべてそれを通す。

-- ── 席マスタ ─────────────────────────────────────────────
create table if not exists seat_slots (
  key        text primary key,   -- 'C1' 'T1-3' 'Z5'
  unit_name  text not null,      -- seat_units.name と一致（'カウンター' 'T1' '和室'）
  area       text not null check (area in ('counter', 'table', 'private')),
  label      text not null,      -- ボードに出す短い名前
  sort_order integer not null default 0
);

insert into seat_slots (key, unit_name, area, label, sort_order)
select 'C' || n, 'カウンター', 'counter', n::text, n
  from generate_series(1, 10) as n
on conflict (key) do nothing;

insert into seat_slots (key, unit_name, area, label, sort_order)
select 'T' || t || '-' || n, 'T' || t, 'table', n::text, t * 10 + n
  from generate_series(1, 3) as t, generate_series(1, 6) as n
on conflict (key) do nothing;

insert into seat_slots (key, unit_name, area, label, sort_order)
select 'Z' || n, '和室', 'private', n::text, 100 + n
  from generate_series(1, 8) as n
on conflict (key) do nothing;

alter table seat_slots enable row level security;
do $$ begin
  create policy seat_slots_read on seat_slots for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- ── 着席のセッション ──────────────────────────────────────
create table if not exists seat_log (
  id        bigint generated always as identity primary key,
  biz_date  date not null,
  seat_key  text not null,
  unit_name text not null,
  area      text not null,
  seated_at timestamptz not null default now(),
  left_at   timestamptz,          -- null なら着席中
  seated_by uuid references profiles(id),
  left_by   uuid references profiles(id)
);

-- 同じ席で「開いたままの記録」は1つだけ
create unique index if not exists seat_log_open_one
  on seat_log (biz_date, seat_key) where left_at is null;
create index if not exists seat_log_biz_date on seat_log (biz_date);

alter table seat_log enable row level security;
do $$ begin
  create policy seat_log_read on seat_log for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- ── 1席ぶんの記録（内部用）────────────────────────────────
create or replace function public.set_seat_slot(p_date date, p_key text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot seat_slots%rowtype;
begin
  select * into v_slot from seat_slots where key = p_key;
  if not found then
    raise exception '席の指定が不正です';
  end if;

  insert into seat_board (biz_date, key, occupied, updated_by)
  values (p_date, p_key, case when p_on then 1 else 0 end, auth.uid())
  on conflict (biz_date, key)
  do update set occupied = excluded.occupied, updated_by = auth.uid(), updated_at = now();

  if p_on then
    -- すでに座っている記録があるなら二重に始めない
    insert into seat_log (biz_date, seat_key, unit_name, area, seated_by)
    select p_date, p_key, v_slot.unit_name, v_slot.area, auth.uid()
     where not exists (
       select 1 from seat_log where biz_date = p_date and seat_key = p_key and left_at is null
     );
  else
    update seat_log
       set left_at = now(), left_by = auth.uid()
     where biz_date = p_date and seat_key = p_key and left_at is null;
  end if;
end;
$$;

-- ── 席ボードの書き込み口（署名は変えない）─────────────────
-- 旧キー（'T1' '和室' 'C'）で来ても席単位へ翻訳して受ける。
-- こうしておくと、更新前のタブレットが残っていても記録が壊れない。
create or replace function public.set_seat_board(p_date date, p_key text, p_value integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_on boolean;
  r    record;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if p_value is null or p_value < 0 or p_value > 10 then
    raise exception '値が不正です';
  end if;

  -- 日付が変わったのに閉じ忘れている記録は、その営業日の終わり（翌朝4時）で閉じる
  update seat_log
     set left_at = ((biz_date + 1)::timestamp + interval '4 hours') at time zone 'Asia/Tokyo'
   where left_at is null and biz_date < p_date;

  v_on := p_value > 0;

  if exists (select 1 from seat_slots where key = p_key) then
    perform set_seat_slot(p_date, p_key, v_on);

  elsif p_key = 'C' then
    -- 旧方式：使用席数だけが来る。若い番号から順に埋める
    for r in select key, row_number() over (order by sort_order) as n
               from seat_slots where unit_name = 'カウンター'
    loop
      perform set_seat_slot(p_date, r.key, r.n <= p_value);
    end loop;

  elsif p_key in ('T1', 'T2', 'T3', '和室') then
    -- 旧方式：卓ごと。卓が使用中＝その卓の席は全部埋まっている、として翻訳する
    for r in select key from seat_slots where unit_name = p_key
    loop
      perform set_seat_slot(p_date, r.key, v_on);
    end loop;
    delete from seat_board where biz_date = p_date and key = p_key;

  else
    raise exception '席の指定が不正です';
  end if;
end;
$$;

grant execute on function public.set_seat_board(date, text, integer) to authenticated;
revoke execute on function public.set_seat_slot(date, text, boolean) from public, anon, authenticated;

-- ── 既存データの引っ越し ──────────────────────────────────
-- 今日以降の旧キー行を席単位に展開して、旧行は消す。
-- （消さないと、新しい画面からは触れない「一晩中埋まったままの卓」になる）
-- 過去日はその晩の記録なのでそのまま残す。
do $$
declare
  v_today date := ((now() at time zone 'Asia/Tokyo') - interval '4 hours')::date;
  b record;
  s record;
begin
  for b in select * from seat_board
            where biz_date >= v_today and key in ('T1', 'T2', 'T3', '和室', 'C')
  loop
    if b.key = 'C' then
      for s in select key, row_number() over (order by sort_order) as n
                 from seat_slots where unit_name = 'カウンター'
      loop
        insert into seat_board (biz_date, key, occupied)
        values (b.biz_date, s.key, case when s.n <= b.occupied then 1 else 0 end)
        on conflict (biz_date, key) do update
          set occupied = greatest(seat_board.occupied, excluded.occupied);
      end loop;
    else
      for s in select key from seat_slots where unit_name = b.key
      loop
        insert into seat_board (biz_date, key, occupied)
        values (b.biz_date, s.key, b.occupied)
        on conflict (biz_date, key) do update
          set occupied = greatest(seat_board.occupied, excluded.occupied);
      end loop;
    end if;
    delete from seat_board where biz_date = b.biz_date and key = b.key;
  end loop;
end $$;

-- ── 最後の砦：空席判定を席マスタ経由にする ────────────────
create or replace function public.net_reserve(
  p_date      date,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_party     integer,
  p_name      text,
  p_kana      text,
  p_phone     text,
  p_memo      text,
  p_seat_note text
) returns table (id uuid, reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day    business_days%rowtype;
  v_found  boolean;
  v_busy   boolean;
  v_cap    integer;
  v_guests integer;
  v_unit   seat_units%rowtype;
  v_used   integer;
  v_today  date;
begin
  if p_party is null or p_party < 1 or p_party > 8 then
    raise exception 'NET_PARTY';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'NET_NAME';
  end if;

  perform pg_advisory_xact_lock(hashtext('net-reserve-' || p_date::text));

  if exists (select 1 from net_pause where biz_date = p_date and ended_at is null) then
    raise exception 'NET_PAUSED';
  end if;

  v_today := ((now() at time zone 'Asia/Tokyo') - interval '4 hours')::date;

  select * into v_day from business_days where biz_date = p_date;
  v_found := found;

  if v_found and v_day.is_closed then
    raise exception 'NET_CLOSED';
  end if;

  if v_found and v_day.mode = 'event' and p_date <= v_today then
    raise exception 'NET_EVENT_TODAY';
  end if;

  v_busy := case when v_found then v_day.is_busy
                 else extract(dow from p_date) in (5, 6) end;

  if v_found and v_day.mode = 'event' then
    v_cap := coalesce(v_day.event_capacity, 36);
    select coalesce(sum(party_size), 0) into v_guests
      from reservations
     where biz_date = p_date and status in ('tentative', 'confirmed', 'seated');
    if v_guests + p_party > v_cap then
      raise exception 'NET_FULL';
    end if;
  elsif p_seat_note is not null and p_seat_note <> '指定なし' then
    select * into v_unit from seat_units where name = p_seat_note and is_active;
    if not found then
      raise exception 'NET_SEAT_UNKNOWN';
    end if;
    if v_busy and p_party <= 3 and not v_unit.is_shared then
      raise exception 'NET_BUSY_RULE';
    end if;
    if v_unit.is_shared then
      select coalesce(sum(party_size), 0) into v_used
        from reservations
       where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
         and seat_note is not null
         and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'));
      -- 席ボード（飛び込み）は予約と重なっている可能性があるので大きい方を採る
      v_used := greatest(
        v_used,
        coalesce((select occupied from seat_board where biz_date = p_date and key = 'C'), 0),
        coalesce((select count(*) from seat_board b
                    join seat_slots s on s.key = b.key
                   where b.biz_date = p_date and b.occupied > 0
                     and s.unit_name = p_seat_note), 0));
      if v_used + p_party > v_unit.capacity then
        raise exception 'NET_FULL';
      end if;
    else
      -- 1席でも埋まっていれば、その卓は満席として扱う（店主指定）。
      -- coalesce で、席マスタに無い旧キー（'T1' '和室'）はキー自体を卓名とみなす
      if exists (
        select 1 from reservations
         where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
           and seat_note is not null
           and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'))
      ) or exists (
        select 1 from seat_board b
          left join seat_slots s on s.key = b.key
         where b.biz_date = p_date and b.occupied > 0
           and coalesce(s.unit_name, b.key) = p_seat_note
      ) then
        raise exception 'NET_FULL';
      end if;
    end if;
  end if;

  return query
  insert into reservations
    (biz_date, starts_at, ends_at, party_size, customer_name, customer_kana, phone,
     source, source_detail, status, seat_note, memo)
  values
    (p_date, p_starts_at, p_ends_at, p_party, btrim(p_name), nullif(btrim(coalesce(p_kana, '')), ''),
     p_phone, 'web_form', 'ネット予約', 'confirmed', p_seat_note,
     nullif(btrim(coalesce(p_memo, '')), ''))
  returning reservations.id, reservations.reference;
end;
$$;

-- 0030 売上を税率で分ける（店内飲食と物販の切り分け）
-- 0030 売上を税率で分ける（店内飲食と物販の切り分け）
--
-- うなぎの太巻きのような物販が1日で62万入ると、その日の売上が通常営業の5日分になり、
-- 平均・前年比・目標の達成判定がすべて歪む。かといって手で分類するのは続かない。
--
-- 日本の消費税は、店内で食べれば10%、持ち帰れば8%（軽減税率）。
-- つまりエアレジが税率別に出している金額が、そのまま「店内飲食」と「物販」の境目になる。
--   10% … 店内飲食（お酒を含む）
--    8% … 持ち帰りの食品（太巻き・オードブルなど）
--
-- 完全ではない（持ち帰りのお酒は10%、店内で食べた太巻きも10%）が、
-- この店の商売では実用上まっすぐ切れる。
--
-- 解釈ではなく「税率いくらの売上がいくらか」という事実のまま持つ。
-- 店内／物販への読み替えはアプリ側で行う——将来ルールが変わっても、記録は壊れない。

alter table sales_daily add column if not exists tax10_yen integer
  check (tax10_yen is null or (tax10_yen >= 0 and tax10_yen <= 100000000));
alter table sales_daily add column if not exists tax8_yen integer
  check (tax8_yen is null or (tax8_yen >= 0 and tax8_yen <= 100000000));

comment on column sales_daily.tax10_yen is
  '消費税10%対象の売上（＝店内飲食）。エアレジの税率別集計から取り込む。未取得の日は null';
comment on column sales_daily.tax8_yen is
  '消費税8%対象の売上（＝持ち帰り＝物販）。エアレジの税率別集計から取り込む。未取得の日は null';

-- 手入力（営業日の設定画面）からは税率別を触らない。既存の関数はそのままでよいが、
-- 引数を増やさずに済むよう、ここでは何も変えない。

-- 分析用ビューがあれば、店内／物販を出せるように作り直す
-- （supabase/analysis/01_v_sales_day.sql と同じ定義に2列足したもの。無ければ何もしない）
do $$
begin
  if exists (select 1 from information_schema.views
              where table_schema = 'public' and table_name = 'v_sales_day') then
    -- 列を途中に足すので、置き換えではなく作り直す
    execute 'drop view v_sales_day';
    execute $v$
      create view v_sales_day with (security_invoker = true) as
      select
        s.biz_date,
        extract(dow from s.biz_date)::int as dow,
        (array['日','月','火','水','木','金','土'])[extract(dow from s.biz_date)::int + 1] as dow_ja,
        to_char(s.biz_date, 'YYYY-MM') as ym,
        extract(year  from s.biz_date)::int as yy,
        extract(month from s.biz_date)::int as mm,
        extract(day   from s.biz_date)::int as dd,
        s.target_yen,
        s.actual_yen,
        s.tax10_yen,
        s.tax8_yen,
        -- 店内飲食だけの売上。税率別が無い日は、物販が無かったものとして actual をそのまま使う
        coalesce(s.tax10_yen, s.actual_yen) as dine_in_yen,
        coalesce(s.tax8_yen, 0)             as retail_yen,
        (s.tax8_yen is not null and s.tax8_yen > 0) as has_retail,
        (extract(dow from s.biz_date)::int = 2) as is_tuesday,
        (extract(dow from s.biz_date)::int in (5,6)) as is_fri_sat,
        h.name as holiday_name,
        (h.name is not null) as is_holiday,
        hn.name as next_holiday_name,
        (hn.name is not null) as is_holiday_eve,
        (extract(dow from s.biz_date + 1)::int in (0,6) or hn.name is not null) as tomorrow_off,
        (to_char(s.biz_date,'MM-DD') between '08-11' and '08-16') as is_obon,
        (extract(month from s.biz_date)::int = 12
           and extract(day from s.biz_date)::int >= 10) as is_bounenkai,
        (to_char(s.biz_date,'MM-DD') between '10-16' and '10-18') as is_taiko_matsuri,
        b.mode, b.is_busy, b.is_closed, b.event_name, b.open_min, b.close_min
      from sales_daily s
      left join jp_holidays h  on h.d = s.biz_date
      left join jp_holidays hn on hn.d = s.biz_date + 1
      left join business_days b on b.biz_date = s.biz_date
    $v$;
    execute 'grant select on v_sales_day to authenticated';
    execute 'revoke all on v_sales_day from anon';
  end if;
end $$;


-- 0031 物販（税率8%）を手でも入れられるようにする
--
-- 0030 でエアレジの税率別を受け取る口は作ったが、週次レポート側が税率別を送れるように
-- なるまでは箱が空のままになる。太巻きの日のような「その日だけ物販が乗った日」は
-- 店主が数字を知っているので、営業日の設定から直接入れられるようにする。
--
-- 入れるのは「うち物販（8%）」の1つだけ。店内飲食は 実績 − 物販 で出す。
-- 2つ入力させると必ず合計が合わなくなる日が出るので、入り口は1つに絞る。

-- 1) ビューの店内飲食を、税率別が片方しか無くても正しく出せるようにする。
--    旧: coalesce(tax10, actual)            … tax8 だけ入れた日に物販が二重に乗る
--    新: coalesce(tax10, actual - tax8)     … どちらの入り方でも合う
do $$
begin
  if exists (select 1 from information_schema.views
              where table_schema = 'public' and table_name = 'v_sales_day') then
    execute 'drop view v_sales_day';
    execute $v$
      create view v_sales_day with (security_invoker = true) as
      select
        s.biz_date,
        extract(dow from s.biz_date)::int as dow,
        (array['日','月','火','水','木','金','土'])[extract(dow from s.biz_date)::int + 1] as dow_ja,
        to_char(s.biz_date, 'YYYY-MM') as ym,
        extract(year  from s.biz_date)::int as yy,
        extract(month from s.biz_date)::int as mm,
        extract(day   from s.biz_date)::int as dd,
        s.target_yen,
        s.actual_yen,
        s.tax10_yen,
        s.tax8_yen,
        -- 店内飲食だけの売上。
        -- エアレジから10%が来ていればそれを使い、無ければ「実績 − 物販」で出す。
        coalesce(s.tax10_yen, s.actual_yen - coalesce(s.tax8_yen, 0)) as dine_in_yen,
        coalesce(s.tax8_yen, 0)             as retail_yen,
        (s.tax8_yen is not null and s.tax8_yen > 0) as has_retail,
        (extract(dow from s.biz_date)::int = 2) as is_tuesday,
        (extract(dow from s.biz_date)::int in (5,6)) as is_fri_sat,
        h.name as holiday_name,
        (h.name is not null) as is_holiday,
        hn.name as next_holiday_name,
        (hn.name is not null) as is_holiday_eve,
        (extract(dow from s.biz_date + 1)::int in (0,6) or hn.name is not null) as tomorrow_off,
        (to_char(s.biz_date,'MM-DD') between '08-11' and '08-16') as is_obon,
        (extract(month from s.biz_date)::int = 12
           and extract(day from s.biz_date)::int >= 10) as is_bounenkai,
        (to_char(s.biz_date,'MM-DD') between '10-16' and '10-18') as is_taiko_matsuri,
        b.mode, b.is_busy, b.is_closed, b.event_name, b.open_min, b.close_min
      from sales_daily s
      left join jp_holidays h  on h.d = s.biz_date
      left join jp_holidays hn on hn.d = s.biz_date + 1
      left join business_days b on b.biz_date = s.biz_date
    $v$;
    execute 'grant select on v_sales_day to authenticated';
    execute 'revoke all on v_sales_day from anon';
  end if;
end $$;

-- 2) 手入力の「うち物販」は、既存の set_sales_day には足さず別の関数にする。
--    引数を増やすと、アプリを先に出した瞬間に目標・実績の保存まで巻き添えで壊れる。
--    別関数なら、物販欄だけが後から効くようになるだけで済む。
create or replace function public.set_sales_retail(p_date date, p_retail integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actual integer;
begin
  if not has_permission('sales.write') then
    raise exception '権限がありません。';
  end if;
  if p_retail is null then
    return;                          -- null は「触らない」
  end if;
  if p_retail < 0 then
    raise exception '金額が不正です。';
  end if;

  select actual_yen into v_actual from sales_daily where biz_date = p_date;

  -- 物販が実績を超えるのは、どちらかの打ち間違い。入る前に止める。
  if p_retail > 0 then
    if v_actual is null then
      raise exception '先にその日の実績を入れてください。';
    end if;
    if p_retail > v_actual then
      raise exception '物販が実績を超えています。';
    end if;
  end if;

  insert into sales_daily (biz_date, tax8_yen, updated_by)
  values (p_date, p_retail, auth.uid())
  on conflict (biz_date) do update
    set tax8_yen   = p_retail,       -- 0 を入れれば「物販なし」に戻せる
        updated_by = auth.uid(),
        updated_at = now();
end;
$$;

revoke execute on function public.set_sales_retail(date, integer) from public, anon;
grant  execute on function public.set_sales_retail(date, integer) to authenticated;


-- 0032 物販を入れたあとの「実績の後出し訂正」を止める
--
-- 0031 の set_sales_retail は、物販を書くときに「物販 ≦ 実績」を確かめる。
-- ところが逆向きが素通りしていた——先に物販を入れておいて、あとから実績だけを
-- 小さい額に直せる。そうなると 店内＝実績−物販 が負になり、
-- カレンダーにも売上タブにもマイナスの金額が出る。
--
-- 訂正は実際に起きる（7/26のカニバリの数字を一度直している）。
-- 入る前に止める。

-- 目標・実績・物販を1回でまとめて書く。
--
-- 0031 では set_sales_day と set_sales_retail の2本に分けたが、それだと
-- 「実績も物販も両方下げる」訂正が通らない。片方ずつ書くので、実績を先に下げると
-- まだ古いままの物販を下回って弾かれ、物販を先に下げると実績を超えて弾かれる。
-- 訂正は実際に起きるので（7/26の数字を一度直している）、3つ揃えて1回で見る。
create or replace function public.set_sales_day_all(
  p_date   date,
  p_target integer,
  p_actual integer,
  p_retail integer
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actual integer;
  v_retail integer;
begin
  if not has_permission('sales.write') then
    raise exception '権限がありません。';
  end if;
  if (p_target is not null and p_target < 0)
     or (p_actual is not null and p_actual < 0)
     or (p_retail is not null and p_retail < 0) then
    raise exception '金額が不正です。';
  end if;

  select actual_yen, tax8_yen into v_actual, v_retail
    from sales_daily where biz_date = p_date;

  -- null は「触らない」。書いたあとの姿で見る。
  v_actual := coalesce(p_actual, v_actual);
  v_retail := coalesce(p_retail, v_retail);

  if v_retail is not null and v_retail > 0 then
    if v_actual is null then
      raise exception '先にその日の実績を入れてください。';
    end if;
    if v_retail > v_actual then
      raise exception '物販が実績を超えています。';
    end if;
  end if;

  insert into sales_daily (biz_date, target_yen, actual_yen, tax8_yen, updated_by)
  values (p_date, p_target, p_actual, p_retail, auth.uid())
  on conflict (biz_date) do update
    set target_yen = coalesce(p_target, sales_daily.target_yen),
        actual_yen = coalesce(p_actual, sales_daily.actual_yen),
        tax8_yen   = coalesce(p_retail, sales_daily.tax8_yen),
        updated_by = auth.uid(),
        updated_at = now();
end;
$$;

revoke execute on function public.set_sales_day_all(date, integer, integer, integer) from public, anon;
grant  execute on function public.set_sales_day_all(date, integer, integer, integer) to authenticated;

-- 分析ビューの「店内」も、アプリと同じ式に揃える。
--   旧: coalesce(tax10, actual - tax8)   … 10%を優先
--   新: coalesce(actual - tax8, tax10)   … 実績を優先
--
-- 画面には「店内 ＋ 物販 ＝ 合計」が並ぶので、この足し算が必ず合う必要がある。
-- 10%を優先すると、商品券や0%対象がある日に合わなくなる。
-- 実績が無い日だけ、エアレジの10%を予備に使う。
do $$
begin
  if exists (select 1 from information_schema.views
              where table_schema = 'public' and table_name = 'v_sales_day') then
    execute 'drop view v_sales_day';
    execute $v$
      create view v_sales_day with (security_invoker = true) as
      select
        s.biz_date,
        extract(dow from s.biz_date)::int as dow,
        (array['日','月','火','水','木','金','土'])[extract(dow from s.biz_date)::int + 1] as dow_ja,
        to_char(s.biz_date, 'YYYY-MM') as ym,
        extract(year  from s.biz_date)::int as yy,
        extract(month from s.biz_date)::int as mm,
        extract(day   from s.biz_date)::int as dd,
        s.target_yen,
        s.actual_yen,
        s.tax10_yen,
        s.tax8_yen,
        coalesce(s.actual_yen - coalesce(s.tax8_yen, 0), s.tax10_yen) as dine_in_yen,
        coalesce(s.tax8_yen, 0)             as retail_yen,
        (s.tax8_yen is not null and s.tax8_yen > 0) as has_retail,
        (extract(dow from s.biz_date)::int = 2) as is_tuesday,
        (extract(dow from s.biz_date)::int in (5,6)) as is_fri_sat,
        h.name as holiday_name,
        (h.name is not null) as is_holiday,
        hn.name as next_holiday_name,
        (hn.name is not null) as is_holiday_eve,
        (extract(dow from s.biz_date + 1)::int in (0,6) or hn.name is not null) as tomorrow_off,
        (to_char(s.biz_date,'MM-DD') between '08-11' and '08-16') as is_obon,
        (extract(month from s.biz_date)::int = 12
           and extract(day from s.biz_date)::int >= 10) as is_bounenkai,
        (to_char(s.biz_date,'MM-DD') between '10-16' and '10-18') as is_taiko_matsuri,
        b.mode, b.is_busy, b.is_closed, b.event_name, b.open_min, b.close_min
      from sales_daily s
      left join jp_holidays h  on h.d = s.biz_date
      left join jp_holidays hn on hn.d = s.biz_date + 1
      left join business_days b on b.biz_date = s.biz_date
    $v$;
    execute 'grant select on v_sales_day to authenticated';
    execute 'revoke all on v_sales_day from anon';
  end if;
end $$;


-- 0033 セキュリティ監査で見つかった穴を塞ぐ（2026-08-11）
--
-- 予約者の氏名と電話番号を守るための回。運用ルールではなく、仕組みで塞ぐ。
-- 見つかったもののうち、DB側で直すぶんをここにまとめる。

-- ─────────────────────────────────────────────────────────────
-- 1) 公開APIの回数制限を入れるための土台
--
-- SMS送信も公開キャンセルも、いまは何回でも叩ける。
-- 電話番号を変えながら回せば、店のTwilio残高で他人にSMSを撃ち込める。
-- 番号を変えても効くのは「宛先ごと」ではなく「全体の天井」なので、3段で見る。
-- ─────────────────────────────────────────────────────────────
create table if not exists public_attempts (
  id         bigserial primary key,
  kind       text not null,               -- 'sms' / 'cancel'
  subject    text,                        -- 電話番号や予約番号のハッシュ（生値は入れない）
  ip         text,
  ok         boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists public_attempts_recent
  on public_attempts (kind, created_at desc);
create index if not exists public_attempts_subject
  on public_attempts (kind, subject, created_at desc);

alter table public_attempts enable row level security;
-- ポリシーを1つも作らない＝service role 以外は触れない
revoke all on public_attempts from public, anon, authenticated;

comment on table public_attempts is
  '公開APIの試行回数。個人情報は入れない（subject はハッシュ）。service role のみ読み書き';

-- 古い記録は溜めない。回数を見るのが目的で、履歴を残すのが目的ではない。
create or replace function public.sweep_public_attempts()
returns void language sql security definer set search_path = public as $$
  delete from public_attempts where created_at < now() - interval '2 days';
$$;
revoke execute on function public.sweep_public_attempts() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2) キャンセルの鍵を、推測できない値にする
--
-- 予約番号 R-YYMM-NNNN は月ごとの連番。電話番号を1つ知っていれば、
-- 0001 から順に投げるだけで他人の予約を消せるし、消さなくても
-- 「この番号の人がこの店に予約している」ことを確かめられる。
-- 番号は電話口で読み上げる表示用として残し、鍵は別に持つ。
-- ─────────────────────────────────────────────────────────────
alter table reservations
  add column if not exists cancel_token uuid not null default gen_random_uuid();

comment on column reservations.cancel_token is
  'Webキャンセルの鍵。予約番号は連番で推測できるので、URLにはこちらを載せる';

-- ─────────────────────────────────────────────────────────────
-- 3) 関数の EXECUTE 権限を締める
--
-- PostgreSQL は新しい関数の EXECUTE を既定で PUBLIC に与える。
-- revoke を1本書き忘れた ensure_business_day() は、いま anon から呼べる状態で、
-- security definer なので RLS を無視して business_days を返してしまう。
-- 「書き忘れない」という運用ではなく、既定値そのものを変えて塞ぐ。
-- ─────────────────────────────────────────────────────────────
revoke execute on all functions in schema public from public, anon;
-- これから作る関数も、既定で anon には渡さない
alter default privileges in schema public revoke execute on functions from public, anon;

-- anon に戻す関数は無い。
-- 公開予約（net_reserve）はブラウザからではなく、サーバー側が service role で呼んでいる。
-- ブラウザ用の Supabase クライアント（src/lib/supabase/client.ts）は
-- どこからも import されていないので、anon が DB を直接触る経路は存在しない。

-- ─────────────────────────────────────────────────────────────
-- 4) 席ボードと予約停止を「有効なスタッフ」だけに
--
-- いまの検査は auth.uid() is null だけ。退職者は profiles.is_active を
-- false にしても Supabase Auth 側は生きているので、古いパスワードで
-- トークンを取れば席を全部埋められる＝ネット予約を止められる。
-- ─────────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  -- 既存の定義の「ログインが必要です」判定だけを差し替える
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_seat_board';
  if v_src is not null then
    v_src := replace(v_src, 'if auth.uid() is null then', 'if not public.is_active_user() then');
    execute v_src;
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_net_pause';
  if v_src is not null then
    v_src := replace(v_src, 'if auth.uid() is null then', 'if not public.is_active_user() then');
    execute v_src;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 5) 席まわりのテーブルを anon から切り離す
--
-- 0009 の revoke は「その時点で存在したテーブル」にしか効いていない。
-- そのあとに足した seat_board / seat_slots / seat_log / net_pause は、
-- anon の権限が付いたまま。読み取りポリシーも using(true) で、
-- ログインさえしていれば退職者でもフロアの状況が読める。
-- ─────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['seat_board','seat_slots','seat_log','net_pause'] loop
    if exists (select 1 from information_schema.tables
                where table_schema='public' and table_name=t) then
      execute format('alter table %I enable row level security', t);
      execute format('revoke all on %I from public, anon', t);
      execute format('grant select on %I to authenticated', t);
      -- 読み取りは「有効なスタッフ」に限る
      execute format('drop policy if exists %I on %I', t || '_select', t);
      execute format(
        'create policy %I on %I for select to authenticated using (is_active_user())',
        t || '_select', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 6) 監査ログから個人情報の値を落とす
--
-- write_audit() は before/after に行を丸ごと入れている。予約1件ごとに
-- 氏名・電話・メモの完全なコピーが audit_logs に増え続け、画面も保持期間も無い。
-- しかも将来「氏名を伏せる」UPDATE を流すと、その UPDATE 自体が
-- before に平文を新しく書き込む。マスクするほど平文が増える。
-- 先にここを直さないと、保持期間の実装が丸ごと無駄になる。
--
-- 「誰がいつどの予約を触ったか」は残るので、監査の目的は損なわれない。
-- 値のハッシュも入れない（電話番号は10^11通りしかなく、総当たりで戻せる）。
-- ─────────────────────────────────────────────────────────────
create or replace function public.write_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  key_col text   := coalesce(tg_argv[0], 'id');
  pii     text[] := array['customer_name','customer_kana','phone','memo',
                          'allergy','invoice_name','source_detail','cancel_reason'];
  b jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  a jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  rec jsonb := coalesce(a, b);
  k text;
begin
  if tg_table_name = 'reservations' then
    foreach k in array pii loop
      if b ? k and b->>k is not null then b := jsonb_set(b, array[k], '"***"'::jsonb); end if;
      if a ? k and a->>k is not null then a := jsonb_set(a, array[k], '"***"'::jsonb); end if;
    end loop;
  end if;
  insert into audit_logs (actor, action, target_table, target_id, before, after)
  values (auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name, rec ->> key_col, b, a);
  return coalesce(new, old);
end;
$$;

-- すでに貯まっているぶんを1回だけ洗う
update audit_logs
   set before = before - 'customer_name' - 'customer_kana' - 'phone' - 'memo'
                       - 'allergy' - 'invoice_name' - 'source_detail' - 'cancel_reason',
       after  = after  - 'customer_name' - 'customer_kana' - 'phone' - 'memo'
                       - 'allergy' - 'invoice_name' - 'source_detail' - 'cancel_reason'
 where target_table = 'reservations'
   and (before is not null or after is not null);

-- ─────────────────────────────────────────────────────────────
-- 7) 連絡先の保存期間
--
-- 来店日から13か月たった予約の「連絡先だけ」を消す。
-- 人数・時刻・流入元・席・状態は残すので、売上と集計は無傷。
-- 基準は status ではなく biz_date にする。status を手で completed に
-- 変える運用は忙しい店では回らず、大半が confirmed のまま残るため。
--
-- 呼び出しは pg_cron が使えるなら日次、使えないなら
-- 週次レポートのバッチから RPC で1日1回呼ぶ。
-- ─────────────────────────────────────────────────────────────
create or replace function public.purge_reservation_pii(p_months integer default 13)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update reservations
     set customer_name = '（保存期間経過）',   -- NOT NULL かつ空文字禁止なので置き換える
         customer_kana = null,
         phone         = null,
         memo          = null,
         allergy       = null,
         invoice_name  = null,
         source_detail = null
   where biz_date < (now() at time zone 'Asia/Tokyo')::date - make_interval(months => p_months)
     and customer_name <> '（保存期間経過）';
  get diagnostics n = row_count;
  insert into audit_logs (actor, action, target_table, target_id, before, after)
  values (null, 'reservations.purge', 'reservations', null, null,
          jsonb_build_object('rows', n, 'months', p_months));
  return n;
end;
$$;
revoke execute on function public.purge_reservation_pii(integer) from public, anon, authenticated;

comment on function public.purge_reservation_pii(integer) is
  '来店日から指定月数を過ぎた予約の連絡先を消す。人数・時刻・流入元は残す';


-- 0034 2026年12月の月間売上目標を訂正（店主確認 2026-08-11）
--
-- 0020 に入れた 2026-12 の月間目標が 2,940,000円 だったが、正しくは 3,940,000円。
-- 桁の打ち間違い（3→2）。
--
-- 見つかった経緯：日毎目標（0019）の合計と月間目標（0020）を突き合わせたところ、
-- 12月だけが 999,998円 ずれていた。他の6か月は配分の丸め差（±6円）で一致している。
--
--   月        日毎の合計    月間目標      差
--   2026-06   2,689,999    2,690,000        -1
--   2026-07   2,750,002    2,750,000        +2
--   2026-08   3,119,997    3,120,000        -3
--   2026-09   2,780,002    2,780,000        +2
--   2026-10   2,110,003    2,110,000        +3
--   2026-11   2,839,994    2,840,000        -6
--   2026-12   3,939,998    2,940,000  +999,998  ← ここだけ桁違い
--
-- 店主が別の場で目標を直したとき、日毎目標だけが差し替わり、月間目標の表が
-- 古いまま残っていた。日毎の合計（＝店主提供の配分）が正なので、そちらに合わせる。
--
-- 直さないと12月は、実績が294万に届いた時点で「月間目標達成」の紙吹雪が出る。
-- 年間で一番大きい月の道のりゲージが、100万円ぶん手前でいっぱいになる。
--
-- 教訓：日毎目標（0019）と月間目標（0020）は同じ数字を2か所に持っている。
-- 片方だけ直すとこうなる。どちらかを直すときは必ず両方見ること。

update sales_monthly set target_yen = 3940000, updated_at = now()
 where ym = '2026-12' and target_yen = 2940000;


-- 0035 2026年の売上目標を「日次の合計＝月間目標」にそろえる（店主指示 2026-08-11）
--
-- 日毎目標（0019）は月間目標を曜日指数で割って作ったので、配分の丸めで
-- 毎月数円の端数が出ていた。店主の指示で、端数はその月の**営業最終日**に寄せて
-- 日次の合計と月間目標をぴったり一致させる。
--
-- ずれは最大でも6円（11月）。営業最終日の目標が数円動くだけで、
-- 日々の運用には何の影響もない。逆に、ここが合っていないと
-- 「日毎を全部達成したのに月間が1円足りない」という気持ち悪い状態が起きる。
--
-- あわせて、1〜5月の月間目標が抜けていたので入れる。
-- 値は日次の合計を1万円単位に丸めたもの（差はいずれも±6円以内なので一意に決まる）。
--
--   月        日次の合計    月間目標     端数
--   2026-01   3,000,002    3,000,000      -2   ← 月間目標を新設
--   2026-02   3,000,000    3,000,000       0   ← 月間目標を新設
--   2026-03   3,799,999    3,800,000      +1   ← 月間目標を新設
--   2026-04   2,839,996    2,840,000      +4   ← 月間目標を新設
--   2026-05   2,929,998    2,930,000      +2   ← 月間目標を新設
--   2026-06   2,689,999    2,690,000      +1
--   2026-07   2,750,002    2,750,000      -2
--   2026-08   3,119,997    3,120,000      +3
--   2026-09   2,780,002    2,780,000      -2
--   2026-10   2,110,003    2,110,000      -3
--   2026-11   2,839,994    2,840,000      +6
--   2026-12   3,939,998    3,940,000      +2

-- ── 1) 抜けていた月間目標を入れる ──────────────────────────
insert into sales_monthly (ym, target_yen) values
  ('2026-01', 3000000),
  ('2026-02', 3000000),
  ('2026-03', 3800000),
  ('2026-04', 2840000),
  ('2026-05', 2930000)
on conflict (ym) do nothing;

-- ── 2) 端数を営業最終日に寄せる ────────────────────────────
--
-- 営業最終日＝その月で target_yen が 0 より大きい最後の日。
-- 火曜定休の日は 0 が入っているので、そこを最終日に選ばないようにする
-- （2026年4月から火曜定休。3月までは火曜も営業しているので 3/31(火) が正しく最終日になる）。
--
-- 差が0なら何もしない＝この回を何度流しても結果は同じ。
do $$
declare
  r      record;
  v_sum  integer;
  v_last date;
  v_diff integer;
begin
  for r in select ym, target_yen from sales_monthly where ym like '2026-%' order by ym loop
    select sum(target_yen), max(biz_date)
      into v_sum, v_last
      from sales_daily
     where to_char(biz_date, 'YYYY-MM') = r.ym
       and coalesce(target_yen, 0) > 0;

    continue when v_last is null;              -- 日毎目標がまだ無い月は触らない

    v_diff := r.target_yen - coalesce(v_sum, 0);
    continue when v_diff = 0;

    -- 端数が数円で収まらないなら、それは丸めではなく入力の食い違い。
    -- 黙って直さず止める（12月の桁違いのようなケースを吸収してしまわないため）。
    if abs(v_diff) > 100 then
      raise exception '% の端数が % 円で、丸めの範囲を超えています。目標そのものを確認してください。',
        r.ym, v_diff;
    end if;

    update sales_daily
       set target_yen = target_yen + v_diff
     where biz_date = v_last;
  end loop;
end $$;

-- ── 3) そろったことを確かめる ──────────────────────────────
do $$
declare r record; v_sum integer;
begin
  for r in select ym, target_yen from sales_monthly where ym like '2026-%' loop
    select coalesce(sum(target_yen), 0) into v_sum
      from sales_daily
     where to_char(biz_date, 'YYYY-MM') = r.ym and coalesce(target_yen, 0) > 0;
    if v_sum <> r.target_yen then
      raise exception '% がそろっていません（日次の合計 % ／ 月間目標 %）', r.ym, v_sum, r.target_yen;
    end if;
  end loop;
end $$;


-- 0036 席まわりの読み取りポリシーの二重掛けを解く（0033 の取りこぼし）
--
-- 0033 で seat_board / seat_slots / seat_log / net_pause の読み取りを
-- is_active_user() に絞ったつもりだったが、効いていなかった。
--
-- 元からあったポリシー名が <table>_read で、0033 が作ったのは <table>_select。
-- PostgreSQL の permissive なポリシーは **OR で結合される** ので、
--   (true) OR (is_active_user())
-- となって常に真。つまり退職者でもフロアの状況が読めるままだった。
--
-- 教訓：ポリシーを「置き換える」つもりのときは、同じ名前で作り直すか、
-- 古いほうを名指しで消すこと。名前を変えて足すと、足しただけになる。
--
-- 書き込みのポリシーは元々1つも無い（更新は security definer 関数だけが行う）ので、
-- SELECT のポリシーを1本にするだけでよい。

do $$
declare
  t text;
  p record;
begin
  foreach t in array array['seat_board','seat_slots','seat_log','net_pause'] loop
    if not exists (select 1 from information_schema.tables
                    where table_schema='public' and table_name=t) then
      continue;
    end if;

    -- この表の SELECT ポリシーのうち、今回の <table>_select 以外を全部落とす
    for p in
      select pol.polname
        from pg_policy pol
        join pg_class c on c.oid = pol.polrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = t
         and pol.polcmd = 'r'
         and pol.polname <> t || '_select'
    loop
      execute format('drop policy %I on %I', p.polname, t);
    end loop;

    -- 念のため、残す1本を作り直す（0033 が流れていない環境でも成立させる）
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format(
      'create policy %I on %I for select to authenticated using (is_active_user())',
      t || '_select', t);
  end loop;
end $$;

-- 確かめる：SELECT ポリシーがちょうど1本で、条件が is_active_user() であること
do $$
declare t text; v_cnt integer; v_qual text;
begin
  foreach t in array array['seat_board','seat_slots','seat_log','net_pause'] loop
    if not exists (select 1 from information_schema.tables
                    where table_schema='public' and table_name=t) then
      continue;
    end if;
    select count(*), max(pg_get_expr(pol.polqual, pol.polrelid))
      into v_cnt, v_qual
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relname = t and pol.polcmd = 'r';
    if v_cnt <> 1 or v_qual <> 'is_active_user()' then
      raise exception '% の読み取りポリシーが想定と違います（% 本 / %）', t, v_cnt, v_qual;
    end if;
  end loop;
end $$;


-- 0037 貸切の日はネット予約を受けない（DB側の最後の砦）
--
-- 貸切（is_exclusive・25名様〜のフロア一体利用）は、席が個別に埋まっていなくても
-- その日は店ごと押さえている。ところが空席判定はどこも is_exclusive を見ておらず、
-- 貸切の日でも予約ページが「◯空席あり」を出し、お客様が予約できてしまっていた。
-- 来店して初めて貸切だと分かる——店にとってもお客様にとっても一番まずい形。
--
-- アプリ側（src/lib/public-booking.ts の dayStatus）でも塞いだが、
-- net_reserve は「アプリを信用せず、DBが最後に拒否する」ための関数なので、
-- ここにも同じ判定を置く。
--
-- 差し込む場所は advisory lock を取ったすぐ後、NET_PAUSED の隣。
-- どちらも「席の空き以前に、その日はもう受けない」という同じ性質の判定なので。
--
-- 既存の合図と同じく例外で返す。予約ページ側は NET_FULL と同じ扱いにして
-- 「たった今この枠が埋まりました」と出す（貸切であることは外に出さない）。

do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'net_reserve';

  if v_src is null then
    raise exception 'net_reserve が見つかりません。0021〜0029 が適用されているか確認してください。';
  end if;

  -- 何度流しても同じ結果になるように
  if position('NET_EXCLUSIVE' in v_src) > 0 then
    raise notice '貸切の判定はすでに入っています。何もしません。';
    return;
  end if;

  -- 目印は 0027 で入った NET_PAUSED の判定ブロック。その直後に足す。
  if position('raise exception ''NET_PAUSED'';' in v_src) = 0 then
    raise exception 'net_reserve の中に NET_PAUSED の判定が見つかりません。定義が想定と違います。';
  end if;

  v_new := replace(
    v_src,
    E'    raise exception \'NET_PAUSED\';\n  end if;',
    E'    raise exception \'NET_PAUSED\';\n  end if;\n\n'
      '  -- 貸切は店ごと押さえる予約。席の空きにかかわらずネットからは受けない。\n'
      '  if exists (\n'
      '    select 1 from reservations\n'
      '     where biz_date = p_date\n'
      '       and is_exclusive\n'
      '       and status in (''tentative'',''confirmed'',''seated'')\n'
      '  ) then\n'
      E'    raise exception \'NET_EXCLUSIVE\';\n'
      '  end if;'
  );

  if v_new = v_src then
    raise exception '差し込みに失敗しました（置換が一致しませんでした）。';
  end if;

  execute v_new;
  raise notice '貸切の判定を net_reserve に追加しました。';
end $$;

-- 入ったことを確かめる
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'net_reserve'
       and position('NET_EXCLUSIVE' in pg_get_functiondef(p.oid)) > 0
  ) then
    raise exception 'net_reserve に貸切の判定が入っていません。';
  end if;
end $$;

-- 貸切の日を素早く引けるように（1日に何度も見る判定なので）
create index if not exists reservations_exclusive_idx
  on reservations (biz_date)
  where is_exclusive and status in ('tentative','confirmed','seated');
