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
