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
