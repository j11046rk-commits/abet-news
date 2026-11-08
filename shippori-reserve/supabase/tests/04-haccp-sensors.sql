-- 温度計の自動記録（0068）の DB の守りを確かめる。**捨ててよいデータベースでだけ流すこと。**
-- 全体を1つのトランザクションで流して最後に巻き戻す（何も残さない）。
--   psql -d shippori -v ON_ERROR_STOP=1 -f supabase/tests/04-haccp-sensors.sql
-- 「PASS:」が並び、最後に「ALL HACCP TESTS PASSED」が出れば合格。1つでも外れると FAIL で止まる。
\set ON_ERROR_STOP on
\pset pager off
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'h-owner@test'),
  ('a0000000-0000-0000-0000-000000000002', 'h-manager@test'),
  ('a0000000-0000-0000-0000-000000000003', 'h-staff@test'),
  ('a0000000-0000-0000-0000-000000000004', 'h-staff2@test'),
  ('a0000000-0000-0000-0000-000000000005', 'h-viewer@test'),
  ('a0000000-0000-0000-0000-000000000006', 'h-jimu@test');
insert into profiles (id, login_id, display_name, role, must_change_password) values
  ('a0000000-0000-0000-0000-000000000001', 'h-owner', 'オーナー', 'owner', false),
  ('a0000000-0000-0000-0000-000000000002', 'h-manager', '店長', 'manager', false),
  ('a0000000-0000-0000-0000-000000000003', 'h-staff', 'スタッフA', 'staff', false),
  ('a0000000-0000-0000-0000-000000000004', 'h-staff2', 'スタッフB', 'staff', false),
  ('a0000000-0000-0000-0000-000000000005', 'h-viewer', '閲覧', 'viewer', false),
  ('a0000000-0000-0000-0000-000000000006', 'h-jimu', '事務', 'jimu', false);

-- テストの手助け：ある人として1文を流し、拒否されれば PASS
create or replace function pg_temp.expect_error(who uuid, stmt text, label text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', who::text, true);
  execute 'set local role authenticated';
  begin
    execute stmt;
  exception when others then
    execute 'reset role';
    raise notice 'PASS: % （%）', label, sqlerrm;
    return;
  end;
  execute 'reset role';
  raise exception 'FAIL: % が通ってしまった', label;
end $$;

create or replace function pg_temp.run_as(who uuid, stmt text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', who::text, true);
  execute 'set local role authenticated';
  execute stmt;
  execute 'reset role';
end $$;

create or replace function pg_temp.count_as(who uuid, q text) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  execute 'set local role authenticated';
  execute 'select count(*) from (' || q || ') x' into n;
  execute 'reset role';
  return n;
end $$;

create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond then raise notice 'PASS: %', label; else raise exception 'FAIL: %', label; end if;
end $$;

\set O '''a0000000-0000-0000-0000-000000000001'''
\set M '''a0000000-0000-0000-0000-000000000002'''
\set S '''a0000000-0000-0000-0000-000000000003'''
\set V '''a0000000-0000-0000-0000-000000000005'''
\set J '''a0000000-0000-0000-0000-000000000006'''

-- 承認済みの計画（テスト用）を1つ置く
set session_replication_role = replica;
insert into haccp_plans (id, version, status, effective_from, content, approved_at)
values ('b0000000-0000-0000-0000-000000000001', 901, 'approved', date '2026-01-01', '{"equipment":[{"id":"fz1","name":"冷凍庫①","kind":"freezer","maxC":-15,"minC":null,"timings":[],"basis":"","auto":true}]}', now());
set session_replication_role = origin;

-- 1. 温度計の結びつけは店長・オーナーだけ。スタッフは見るだけ
select pg_temp.run_as(:M, $$insert into haccp_sensors (device_id, device_name, equipment_id) values ('AABBCCDD0001', '冷凍1', 'fz1')$$);
select pg_temp.expect_error(:S, $$insert into haccp_sensors (device_id, equipment_id) values ('AABBCCDD0002', 'fz2')$$, 'スタッフは温度計を結びつけられない');
select pg_temp.ok(pg_temp.count_as(:S, 'select * from haccp_sensors') = 1, 'スタッフは温度計の一覧を見られる');
select pg_temp.ok(pg_temp.count_as(:J, 'select * from haccp_sensors') = 0, '事務（衛生の権限なし）には見えない');
select pg_temp.expect_error(:M, $$insert into haccp_sensors (device_id, equipment_id) values ('AABBCCDD0003', 'fz1')$$, '1つの設備に温度計は1つ');
select pg_temp.expect_error(:M, $$insert into haccp_sensors (device_id) values ('bad id!')$$, '温度計のIDの形');

-- 2. 読み取った値はサーバーだけが書く。見るのは衛生の記録ができる人
select set_config('request.jwt.claim.sub', '', true);
insert into haccp_temp_readings (device_id, equipment_id, temp_c, humidity, battery) values ('AABBCCDD0001', 'fz1', -18.4, 40, 100);
select pg_temp.expect_error(:M, $$insert into haccp_temp_readings (device_id, temp_c) values ('AABBCCDD0001', -1)$$, '画面からは値を書けない（オーナー・店長でも）');
select pg_temp.ok(pg_temp.count_as(:S, 'select * from haccp_temp_readings') = 1, 'スタッフは値を見られる');
select pg_temp.ok(pg_temp.count_as(:V, 'select * from haccp_temp_readings') = 0, '閲覧のみには見えない');
select pg_temp.ok(pg_temp.count_as(:O, 'select * from haccp_sensor_alerts') = 0, '知らせた記録は画面から見えない');

-- 3. 自動の記録（source=auto）は記録者なしで入る。人の記録（manual）は記録者が要る
-- サーバー（管理キー）にはログインした人がいない。前の手順で装った人を外してから書く
select set_config('request.jwt.claim.sub', '', true);
insert into haccp_checks (biz_date, check_key, plan_id, result, temp_c, source, recorded_by, note)
values (haccp_biz_today(), 'eq:fz1:close', 'b0000000-0000-0000-0000-000000000001', 'ok', -18.4, 'auto', null, '温度計で自動記録');
select pg_temp.ok((select recorded_by is null and source = 'auto' and first_result = 'ok' from haccp_checks where check_key = 'eq:fz1:close'), '自動の記録は記録者なしで入る');
do $$ begin
  begin
    insert into haccp_checks (biz_date, check_key, plan_id, result, recorded_by)
    values (haccp_biz_today(), 'eq:fz9:close', 'b0000000-0000-0000-0000-000000000001', 'ok', null);
    raise exception 'FAIL: 記録者なしの手入力が通ってしまった';
  exception when check_violation then raise notice 'PASS: 手で入れる記録は記録者が要る';
  end;
end $$;
select pg_temp.expect_error(:O, $$update haccp_checks set result = 'ng', note = '再確認で高かった' where check_key = 'eq:fz1:close'$$, '自動の記録を直すのにも理由が要る');
select pg_temp.run_as(:O, $$update haccp_checks set result = 'ng', note = '再確認で高かった', edit_reason = '扉が半開きだった' where check_key = 'eq:fz1:close'$$);
select pg_temp.ok((select first_result = 'ok' and result = 'ng' and updated_by = 'a0000000-0000-0000-0000-000000000001' from haccp_checks where check_key = 'eq:fz1:close'), '直しても最初の結果（自動のok）は残り、直した人が入る');

\echo 'ALL SENSOR TESTS PASSED'
rollback;
