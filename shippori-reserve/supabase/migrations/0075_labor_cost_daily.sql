-- 0075 1日の人件費（店全体の合計）（店主指示 2026-11-09「人件費も毎日リアルタイムで。この日の人件費いくら、人件費率何%を明示」）
--
--   ・freee人事労務の時給・月給・手当・社会保険と、その日の勤怠から、サーバーの中で一人ずつ計算して「合計だけ」を残す。
--     一人ずつの額・時給はどこにも保存しない。
--   ・見られるのは店長・オーナーだけ（shift.write）。出勤が2〜3人の日は、自分の分を引けば
--     他の人の額が分かってしまうため（月の合計は人数が多く、店舗評価には率だけを出す）。
--   ・給与が確定した月は、給与明細の合計（総支給額＋法定福利費の会社負担・役員を除く）を labor_cost_monthly に入れる（source = freee）。
--     オーナーが手で入れた月（source = manual）は上書きしない。

create table if not exists labor_cost_daily (
  biz_date    date primary key,
  cost_yen    integer not null check (cost_yen between 0 and 10000000),
  fetched_at  timestamptz not null default now()
);
alter table labor_cost_daily enable row level security;
drop policy if exists labor_cost_daily_select on labor_cost_daily;
create policy labor_cost_daily_select on labor_cost_daily for select to authenticated using (has_permission('shift.write'));

alter table labor_cost_monthly add column if not exists source text not null default 'manual'
  check (source in ('manual', 'freee'));

comment on table labor_cost_daily is '1日の人件費の合計（freeeの給与設定×勤怠から推定・速報）。店長・オーナーだけ。個人の額は持たない';
