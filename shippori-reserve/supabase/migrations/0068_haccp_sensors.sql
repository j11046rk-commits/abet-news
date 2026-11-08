-- 0068 冷蔵庫・冷凍庫の温度を SwitchBot の温度計で自動記録（店主指定 2026-11-04「温度の手入力はしない」・2026-11-08 設置完了）
--
--   30分ごと：温度計を読んで haccp_temp_readings に残す（GitHub Actions → /api/cron/switchbot）
--             基準を外れた状態が続いたら・データが来ない・電池が少ないときは店のLINEに知らせる
--   毎晩1回：その営業日の最後の値を、衛生管理の記録（haccp_checks・eq:<設備>:close）に「自動」として書く
--             （Vercel の定期実行 → /api/cron/haccp-auto）
--
-- 決めごと
--   ・自動の記録は source = 'auto'。記録者（recorded_by）は空。手で入れた記録と画面で区別できる
--   ・温度計と設備（計画の equipment.id）の結びつけは店長・オーナーが画面で行う。結びつけない温度計は「参考に見るだけ」
--   ・読み取った値は消さない（記録の裏付け）。自動で消す仕組みも作らない

-- ── 温度計 ─────────────────────────────────────────────
create table if not exists haccp_sensors (
  device_id     text primary key check (device_id ~ '^[A-Za-z0-9:_-]{4,64}$'),
  device_name   text not null default '',
  device_type   text not null default '',
  equipment_id  text check (equipment_id is null or equipment_id ~ '^[A-Za-z0-9_-]{1,40}$'),  -- 計画の設備ID（fz1 など）。null＝参考に見るだけ
  updated_by    uuid references profiles(id) default auth.uid(),
  updated_at    timestamptz not null default now()
);
-- 1つの設備に温度計は1つ
create unique index if not exists haccp_sensors_equipment_uniq on haccp_sensors (equipment_id) where equipment_id is not null;

-- ── 読み取った値 ─────────────────────────────────────────
create table if not exists haccp_temp_readings (
  id           bigint generated always as identity primary key,
  device_id    text not null,
  equipment_id text,                       -- 読んだ時点の結びつけ（あとで付け替えても過去の値は動かない）
  temp_c       numeric(5, 1) not null,
  humidity     integer,
  battery      integer,
  read_at      timestamptz not null default now()
);
create index if not exists haccp_temp_readings_dev_at on haccp_temp_readings (device_id, read_at desc);
create index if not exists haccp_temp_readings_eq_at on haccp_temp_readings (equipment_id, read_at desc);

-- ── 知らせた記録（同じ知らせを何度も送らない）─────────────────────
create table if not exists haccp_sensor_alerts (
  device_id   text not null,
  kind        text not null check (kind in ('out_of_range', 'stale', 'battery', 'error')),
  sent_at     timestamptz not null default now(),
  primary key (device_id, kind)
);

-- ── 衛生管理の記録に「自動」を足す ─────────────────────────────
alter table haccp_checks add column if not exists source text not null default 'manual'
  check (source in ('manual', 'auto'));
alter table haccp_checks alter column recorded_by drop not null;
alter table haccp_checks drop constraint if exists haccp_checks_recorded_by_src;
alter table haccp_checks add constraint haccp_checks_recorded_by_src
  check (source = 'auto' or recorded_by is not null);

comment on column haccp_checks.source is 'manual＝人が記録 / auto＝温度計（SwitchBot）から自動で記録（recorded_by は空）';

-- ── RLS ───────────────────────────────────────────────
alter table haccp_sensors enable row level security;
alter table haccp_temp_readings enable row level security;
alter table haccp_sensor_alerts enable row level security;

drop policy if exists haccp_sensors_select on haccp_sensors;
create policy haccp_sensors_select on haccp_sensors for select to authenticated using (has_permission('haccp.record'));
drop policy if exists haccp_sensors_write on haccp_sensors;
create policy haccp_sensors_write on haccp_sensors for all to authenticated
  using (has_permission('haccp.manage')) with check (has_permission('haccp.manage'));

-- 読み取った値は見るだけ（書くのはサーバーの定期実行だけ）
drop policy if exists haccp_temp_readings_select on haccp_temp_readings;
create policy haccp_temp_readings_select on haccp_temp_readings for select to authenticated using (has_permission('haccp.record'));
-- haccp_sensor_alerts は方針なし（サーバーだけ）
