-- 0076 タイムカードの押し忘れ（店主指示 2026-11-09）
--   毎朝の freee 取り込みで見つけ、店長LINEに1回だけ知らせる（店長が実際の時刻を書く → 事務が freee で直す）。
--   直ると翌朝の取り込みで resolved_at が入る。名前・日付・何が抜けているかだけを持つ（時給・金額は持たない）。

create table if not exists timecard_issues (
  id           bigint generated always as identity primary key,
  biz_date     date not null,
  employee_id  bigint not null,            -- freee の従業員ID
  name         text not null check (length(name) <= 60),
  kind         text not null check (kind in ('no_clock_out', 'no_break_end', 'no_clock_in')),
  detail       text check (detail is null or length(detail) <= 60),
  first_seen_at timestamptz not null default now(),
  notified_at  timestamptz,
  resolved_at  timestamptz,
  unique (biz_date, employee_id, kind)
);
create index if not exists timecard_issues_open on timecard_issues (biz_date) where resolved_at is null;

alter table timecard_issues enable row level security;
drop policy if exists timecard_issues_select on timecard_issues;
create policy timecard_issues_select on timecard_issues for select to authenticated using (has_permission('shift.write'));

comment on table timecard_issues is 'タイムカードの押し忘れ（freeeの勤怠から毎朝見つける）。店長LINEに1回知らせ、直ると resolved_at';
