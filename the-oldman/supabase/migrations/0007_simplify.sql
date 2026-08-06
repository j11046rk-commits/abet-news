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
