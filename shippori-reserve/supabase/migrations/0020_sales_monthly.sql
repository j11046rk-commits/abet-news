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
