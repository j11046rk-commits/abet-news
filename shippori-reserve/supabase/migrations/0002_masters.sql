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
