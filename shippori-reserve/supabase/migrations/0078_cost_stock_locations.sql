-- 0078 棚卸の品目を「場所ごと」に分けて、並び替えられるように（店主指示 2026-11-09
--      「店長のユートが使いやすいように並び替えができて、場所ごとに部門分けできるように」）
--
--   cost_stock_locations … 場所（冷蔵庫①・乾物の棚など）と並び順
--   cost_stock_items.location_id … 品目を置いている場所（空＝場所なし）。並び順は今までの sort（場所の中での順）

create table if not exists cost_stock_locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(btrim(name)) between 1 and 30),
  sort       integer not null default 0,
  created_at timestamptz not null default now()
);

alter table cost_stock_items add column if not exists location_id uuid references cost_stock_locations(id) on delete set null;
create index if not exists cost_stock_items_location on cost_stock_items (location_id, sort);

alter table cost_stock_locations enable row level security;
drop policy if exists cost_stock_locations_read on cost_stock_locations;
create policy cost_stock_locations_read on cost_stock_locations for select to authenticated using (has_permission('cost.read'));
drop policy if exists cost_stock_locations_write on cost_stock_locations;
create policy cost_stock_locations_write on cost_stock_locations for all to authenticated
  using (has_permission('cost.write')) with check (has_permission('cost.write'));

-- 最初の場所（店長が画面で名前・順番を変えられる）
insert into cost_stock_locations (name, sort)
select v.name, v.sort from (values
  ('冷蔵庫①', 10), ('冷蔵庫②', 20), ('冷蔵庫③', 30),
  ('冷凍庫①', 40), ('冷凍庫②', 50), ('冷凍庫③', 60),
  ('乾物・調味料の棚', 70), ('酒・ドリンク', 80)
) as v(name, sort)
where not exists (select 1 from cost_stock_locations);
