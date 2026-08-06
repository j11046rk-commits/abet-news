-- ============================================================
-- The Oldman — セットアップ用SQL（本番用・これ1本を貼れば完了）
-- ============================================================
-- Supabase ダッシュボード → SQL Editor に全文を貼って Run する。
-- migrations/0001 0002 0003 0004 0006 を順番に連結したもの。
--
-- ★ ダミーデータ（0005_seed.sql）は含めていない。
--   過去3ヶ月ぶんの架空のセッションと台帳が入ってしまい、
--   ダッシュボードの積立額が嘘の数字になるため。
--   デモとして中身を見たい場合だけ、あとから 0005 を別途実行する。
--
-- 実行後にやること：
--   1. Authentication → Providers → Email を有効化、Confirm email を無効化
--   2. Authentication → Sign-ups を無効化
--   3. 最初のオーナー1人を作る（supabase/README.md 参照）
-- ============================================================


-- ═══════════════════════════════════════════════════════════
-- 0001_schema.sql
-- ═══════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════
-- 0002_views.sql
-- ═══════════════════════════════════════════════════════════

-- The Oldman — 0002 views
-- security_invoker = on : ビュー経由でも呼び出し元の RLS が効くようにする（PG15+ / Supabase）

-- ── 年月ごとの収入・支出・当月収支・累計残高 ────────────────────────────
create view v_monthly_summary
with (security_invoker = on) as
with m as (
  select
    to_char(entry_date, 'YYYY-MM') as ym,
    coalesce(sum(amount_yen) filter (where direction = 'income'),  0)::integer as income_yen,
    coalesce(sum(amount_yen) filter (where direction = 'expense'), 0)::integer as expense_yen
  from ledger_entries
  group by 1
)
select
  ym,
  income_yen,
  expense_yen,
  (income_yen - expense_yen)::integer as net_yen,
  sum(income_yen - expense_yen) over (
    order by ym rows between unbounded preceding and current row
  )::integer as balance_yen
from m;

comment on view v_monthly_summary is
  '年月(JST基準の entry_date)ごとの収入合計・支出合計・当月収支・累計残高。';

-- ── セッション統計（1行）────────────────────────────────────────────────
create view v_session_stats
with (security_invoker = on) as
select
  count(*)::integer                                                     as session_count,
  coalesce(round(avg(rake_yen)), 0)::integer                            as avg_rake_yen,
  coalesce(round(avg(rake_yen) filter (
    where started_at >= now() - interval '90 days')), 0)::integer       as avg_rake_90d_yen,
  count(*) filter (where started_at >= now() - interval '30 days')::integer as sessions_last_30d,
  coalesce(sum(rake_yen), 0)::integer                                   as total_rake_yen,
  max(started_at)                                                       as last_session_at
from sessions;

comment on view v_session_stats is
  'セッションあたりの平均レーキ（全期間 / 直近90日）と、直近30日の開催回数。';

-- ── アカウント別・年月別の貸切 / 通常 利用時間 ──────────────────────────
create view v_exclusive_hours
with (security_invoker = on) as
select
  r.created_by as profile_id,
  to_char(r.starts_at at time zone 'Asia/Tokyo', 'YYYY-MM') as ym,
  coalesce(round(sum(extract(epoch from (r.ends_at - r.starts_at)) / 3600)
        filter (where r.is_exclusive)::numeric, 1), 0) as exclusive_hours,
  coalesce(round(sum(extract(epoch from (r.ends_at - r.starts_at)) / 3600)
        filter (where not r.is_exclusive)::numeric, 1), 0) as shared_hours
from reservations r
group by 1, 2;

comment on view v_exclusive_hours is
  'アカウント別・年月別の貸切利用時間と通常利用時間の合計（時間・小数第1位）。罰則も上限もなく、可視化のみを目的とする。';

grant select on v_monthly_summary, v_session_stats, v_exclusive_hours to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 0003_rls.sql
-- ═══════════════════════════════════════════════════════════

-- The Oldman — 0003 RLS
-- 方針：
--   * 閲覧は「有効なアカウント全員」に開く。会計を一人に属人化させないため、台帳も member が読める。
--   * 書き込みは、自分が作ったものと、owner だけ。
--   * is_active = false のアカウントは、ログインできても一切書けない（読みも通さない）。
--   * アカウント発行・パスワードリセットは service role キーで実行するため RLS を通らない。

-- ── ヘルパ（security definer：profiles ポリシー内の再帰を避ける）────────
create or replace function public.current_profile_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from profiles p
  where p.id = auth.uid() and p.is_active
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() = 'owner', false)
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_role() is not null
$$;

revoke execute on function public.current_profile_role() from public, anon;
grant  execute on function public.current_profile_role() to authenticated;
grant  execute on function public.is_owner()             to authenticated;
grant  execute on function public.is_active_user()       to authenticated;

-- ── RLS 有効化 ──────────────────────────────────────────────────────────
alter table profiles        enable row level security;
alter table players         enable row level security;
alter table sessions        enable row level security;
alter table session_players enable row level security;
alter table reservations    enable row level security;
alter table ledger_entries  enable row level security;
alter table fixed_costs     enable row level security;
alter table settings        enable row level security;

-- ── profiles ────────────────────────────────────────────────────────────
-- 自分の行は is_active に関係なく読める（ログイン直後に自分の状態を判定するため）
create policy profiles_select_self on profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_select_all on profiles
  for select to authenticated
  using (public.is_active_user());

-- 本人は表示名のみ変更可。ロール・出資額・有効フラグの変更は owner のみ
create policy profiles_update_self on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_update_owner on profiles
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy profiles_insert_owner on profiles
  for insert to authenticated
  with check (public.is_owner());

-- ロール昇格の防止：本人による更新では role / investment_yen / is_active を変えられない
create or replace function public.guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_owner() then
    return new;
  end if;
  if new.id = auth.uid() then
    new.role           := old.role;
    new.investment_yen := old.investment_yen;
    new.is_active      := old.is_active;
    new.login_id       := old.login_id;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_self_update
  before update on profiles
  for each row execute function public.guard_profile_self_update();

-- ── players ─────────────────────────────────────────────────────────────
create policy players_select on players
  for select to authenticated using (public.is_active_user());

create policy players_insert on players
  for insert to authenticated with check (public.is_active_user());

create policy players_update on players
  for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

create policy players_delete_owner on players
  for delete to authenticated using (public.is_owner());

-- ── sessions ────────────────────────────────────────────────────────────
create policy sessions_select on sessions
  for select to authenticated using (public.is_active_user());

create policy sessions_insert on sessions
  for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid());

create policy sessions_update on sessions
  for update to authenticated
  using (public.is_active_user() and (created_by = auth.uid() or public.is_owner()))
  with check (public.is_active_user() and (created_by = auth.uid() or public.is_owner()));

create policy sessions_delete on sessions
  for delete to authenticated
  using (public.is_active_user() and (created_by = auth.uid() or public.is_owner()));

-- ── session_players（親セッションの権限に従う）──────────────────────────
create policy session_players_select on session_players
  for select to authenticated using (public.is_active_user());

create policy session_players_write on session_players
  for all to authenticated
  using (
    public.is_active_user() and exists (
      select 1 from sessions s
      where s.id = session_id and (s.created_by = auth.uid() or public.is_owner())
    )
  )
  with check (
    public.is_active_user() and exists (
      select 1 from sessions s
      where s.id = session_id and (s.created_by = auth.uid() or public.is_owner())
    )
  );

-- ── reservations ────────────────────────────────────────────────────────
create policy reservations_select on reservations
  for select to authenticated using (public.is_active_user());

create policy reservations_insert on reservations
  for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid());

create policy reservations_update on reservations
  for update to authenticated
  using (public.is_active_user() and (created_by = auth.uid() or public.is_owner()))
  with check (public.is_active_user() and (created_by = auth.uid() or public.is_owner()));

create policy reservations_delete on reservations
  for delete to authenticated
  using (public.is_active_user() and (created_by = auth.uid() or public.is_owner()));

-- ── ledger_entries（閲覧は全員 / 編集は owner）──────────────────────────
create policy ledger_select on ledger_entries
  for select to authenticated using (public.is_active_user());

-- 台帳への手入力は owner のみ。member がセッションを記録したときの
-- レーキ行は 0004 の security definer トリガが起票するため、この制限に触れない。
-- ※ この3つのポリシーは 0006 で差し替え、6人全員が記帳・編集できるようにしている。
create policy ledger_insert_owner on ledger_entries
  for insert to authenticated with check (public.is_owner());

create policy ledger_update_owner on ledger_entries
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy ledger_delete_owner on ledger_entries
  for delete to authenticated using (public.is_owner());

-- ── fixed_costs / settings（閲覧は全員 / 編集は owner）──────────────────
create policy fixed_costs_select on fixed_costs
  for select to authenticated using (public.is_active_user());

create policy fixed_costs_write_owner on fixed_costs
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy settings_select on settings
  for select to authenticated using (public.is_active_user());

create policy settings_write_owner on settings
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- ── 明示的な grant（anon には一切与えない）──────────────────────────────
revoke all on all tables in schema public from anon;

grant select, insert, update, delete on
  profiles, players, sessions, session_players, reservations,
  ledger_entries, fixed_costs, settings
to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 0004_session_ledger_sync.sql
-- ═══════════════════════════════════════════════════════════

-- The Oldman — 0004 セッション → 台帳の自動起票
--
-- セッションを保存すると ledger_entries に income / rake の行が自動で起票される。
-- 同じ数字を二度入力させないための仕組みなので、アプリ側ではなく DB 側に置く。
-- security definer にしてあるため、台帳への直接 insert 権を持たない member が
-- セッションを記録した場合でも起票できる。

create or replace function public.sync_session_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date;
begin
  if tg_op = 'DELETE' then
    delete from ledger_entries
     where session_id = old.id and category = 'rake';
    return old;
  end if;

  v_date := (new.started_at at time zone 'Asia/Tokyo')::date;

  if new.rake_yen > 0 then
    insert into ledger_entries (entry_date, direction, category, amount_yen, memo, session_id, created_by)
    values (v_date, 'income', 'rake', new.rake_yen, null, new.id, new.created_by)
    on conflict (session_id) where (session_id is not null and category = 'rake')
    do update set
      entry_date = excluded.entry_date,
      amount_yen = excluded.amount_yen;
  else
    -- レーキ 0 のセッション（練習卓など）は台帳に行を残さない
    delete from ledger_entries
     where session_id = new.id and category = 'rake';
  end if;

  return new;
end;
$$;

create trigger sessions_sync_ledger_ins
  after insert on sessions
  for each row execute function public.sync_session_ledger();

create trigger sessions_sync_ledger_upd
  after update of started_at, rake_yen on sessions
  for each row execute function public.sync_session_ledger();

create trigger sessions_sync_ledger_del
  before delete on sessions
  for each row execute function public.sync_session_ledger();

-- ═══════════════════════════════════════════════════════════
-- 0006_ledger_write_for_members.sql
-- ═══════════════════════════════════════════════════════════

-- The Oldman — 0006 台帳の書き込みを全メンバーに開放
--
-- 変更理由：この施設は6人で回している。会計を一人に属人化させないという設計意図
-- （SPEC §1 G4）に照らすと、閲覧だけ開いて記帳を owner に閉じるのは中途半端だった。
-- 6人全員が記帳・編集・削除できるようにする。
--
-- ただしセッションから自動起票された行（session_id が入っている行）は対象外。
-- あれはセッションの数字の写しなので、台帳側から直接いじらせない。
-- 0004 のトリガは security definer で動くため、この制限の影響を受けない。

drop policy if exists ledger_insert_owner on ledger_entries;
drop policy if exists ledger_update_owner on ledger_entries;
drop policy if exists ledger_delete_owner on ledger_entries;

create policy ledger_insert on ledger_entries
  for insert to authenticated
  with check (public.is_active_user() and session_id is null);

create policy ledger_update on ledger_entries
  for update to authenticated
  using (public.is_active_user() and session_id is null)
  with check (public.is_active_user() and session_id is null);

create policy ledger_delete on ledger_entries
  for delete to authenticated
  using (public.is_active_user() and session_id is null);

-- 固定費マスタと施設設定は owner のまま（金額の定義を変える操作なので）。
-- 「当月ぶんの固定費を計上する」は台帳への insert なので、上のポリシーで全員が実行できる。

-- ═══════════════════════════════════════════════════════════
-- 初期データ（実運用に必要な最小限だけ）
-- ═══════════════════════════════════════════════════════════

insert into settings (id, facility_name, monthly_target_yen, owner_count, rake_rule)
values (true, 'The Oldman', 100000, 6, null)
on conflict (id) do nothing;

-- 家賃・光熱費は実額に合わせて変更する（アプリの台帳画面からでも編集できる）
insert into fixed_costs (name, amount_yen, billing_day, is_active) values
  ('家賃',   80000, 27, true),
  ('光熱費', 15000,  5, true)
on conflict do nothing;


-- ═══════════════════════════════════════════════════════════
-- 0007_simplify.sql
-- ═══════════════════════════════════════════════════════════

-- The Oldman — 0007 構成の簡素化とチェックイン
--
-- オーナー指示（2026-08-06）：
--   * セッションの参加者リストをやめ、参加人数だけを持つ
--   * 種目（キャッシュ/トーナメント）の区別をやめる
--   * 施設に「いま誰がいるか」を出すため、チェックインを追加する
--   * 固定費は家賃だけにする

-- ── セッション：参加者リスト → 参加人数 ────────────────────────────────
alter table sessions add column if not exists headcount integer not null default 4;
alter table sessions add constraint sessions_headcount_positive check (headcount >= 1);

-- 既存データがあれば参加者数を引き継いでから捨てる
update sessions s
   set headcount = greatest(1, (select count(*) from session_players sp where sp.session_id = s.id))
 where exists (select 1 from session_players sp where sp.session_id = s.id);

drop table if exists session_players;
drop table if exists players;

alter table sessions drop column if exists game_type;
drop type if exists game_type;

-- ── チェックイン ────────────────────────────────────────────────────────
-- 「いま施設にいる人」を出すためだけの最小のテーブル。
-- checked_out_at が null の行が「滞在中」。
create table if not exists check_ins (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz,
  constraint check_ins_time_order check (checked_out_at is null or checked_out_at > checked_in_at)
);

-- 1人につき滞在中の行は1つだけ
create unique index if not exists check_ins_one_open
  on check_ins (profile_id) where checked_out_at is null;

create index if not exists check_ins_recent_idx on check_ins (checked_in_at desc);

alter table check_ins enable row level security;

-- 誰がいるかは全員に見える。打刻できるのは本人だけ。
create policy check_ins_select on check_ins
  for select to authenticated using (public.is_active_user());

create policy check_ins_insert on check_ins
  for insert to authenticated
  with check (public.is_active_user() and profile_id = auth.uid());

create policy check_ins_update on check_ins
  for update to authenticated
  using (public.is_active_user() and profile_id = auth.uid())
  with check (public.is_active_user() and profile_id = auth.uid());

create policy check_ins_delete on check_ins
  for delete to authenticated
  using (public.is_active_user() and profile_id = auth.uid());

grant select, insert, update, delete on check_ins to authenticated;

-- ── 固定費は家賃だけ ────────────────────────────────────────────────────
delete from fixed_costs where name <> '家賃';
insert into fixed_costs (name, amount_yen, billing_day, is_active)
select '家賃', 80000, 27, true
where not exists (select 1 from fixed_costs where name = '家賃');

-- ── 統計ビューの作り直し（game_type を参照していたため）──────────────────
drop view if exists v_session_stats;

create view v_session_stats
with (security_invoker = on) as
select
  count(*)::integer                                                     as session_count,
  coalesce(round(avg(rake_yen)), 0)::integer                            as avg_rake_yen,
  coalesce(round(avg(rake_yen) filter (
    where started_at >= now() - interval '90 days')), 0)::integer       as avg_rake_90d_yen,
  count(*) filter (where started_at >= now() - interval '30 days')::integer as sessions_last_30d,
  coalesce(sum(rake_yen), 0)::integer                                   as total_rake_yen,
  max(started_at)                                                       as last_session_at
from sessions;

grant select on v_session_stats to authenticated;


-- ═══════════════════════════════════════════════════════════
-- 0008_auto_checkout.sql
-- ═══════════════════════════════════════════════════════════

-- The Oldman — 0008 朝10時の自動チェックアウト
--
-- チェックアウトの押し忘れ対策。毎朝10時（JST）に、まだ滞在中の行を締める。
-- 締めた時刻は 10:00 とし、`auto_closed` で「本人が押したのではない」ことを残す。
--
-- 実際に何時に帰ったかは分からない。だから「10時で締めた」という事実だけを記録し、
-- 利用時間の集計でそれが本人の申告と混ざらないようにする。

alter table check_ins add column if not exists auto_closed boolean not null default false;

comment on column check_ins.auto_closed is
  '朝10時の自動締めで閉じた行。本人がチェックアウトを押していないことを示す。';

-- ── 締める関数 ──────────────────────────────────────────────────────────
-- security definer：cron は postgres として動くが、意図を明示しておく。
create or replace function public.close_stale_check_ins()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update check_ins
     set checked_out_at = now(),
         auto_closed = true
   where checked_out_at is null
     and checked_in_at < now();   -- 制約 checked_out_at > checked_in_at を守る

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.close_stale_check_ins() from public, anon, authenticated;

-- ── 毎朝10時（JST）に実行 ───────────────────────────────────────────────
-- pg_cron は UTC で動く。JST 10:00 = UTC 01:00。
-- 同名のジョブが既にあれば消してから作り直す（再実行できるように）。
do $$
begin
  perform cron.unschedule('the-oldman-auto-checkout')
   where exists (select 1 from cron.job where jobname = 'the-oldman-auto-checkout');

  perform cron.schedule(
    'the-oldman-auto-checkout',
    '0 1 * * *',
    $cron$select public.close_stale_check_ins();$cron$
  );
end $$;
