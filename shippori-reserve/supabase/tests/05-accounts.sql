-- アカウント管理の範囲（0079）の DB の守りを確かめる。**捨ててよいデータベースでだけ流すこと。**
-- 全体を1つのトランザクションで流して最後に巻き戻す（何も残さない）。
--   psql -d shippori -v ON_ERROR_STOP=1 -f supabase/tests/05-accounts.sql
-- 「PASS:」が並び、最後に「ALL ACCOUNT TESTS PASSED」が出れば合格。1つでも外れると FAIL で止まる。
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


\set O '\'a0000000-0000-0000-0000-000000000001\''
\set M '\'a0000000-0000-0000-0000-000000000002\''
\set S '\'a0000000-0000-0000-0000-000000000003\''

-- 1. 店長はスタッフの名前・ロール（事務・閲覧のみへ）を変えられる
select pg_temp.run_as(:M, $$update profiles set display_name = 'スタッフA2', role = 'jimu' where login_id = 'h-staff'$$);
select pg_temp.ok((select role = 'jimu' and display_name = 'スタッフA2' from profiles where login_id = 'h-staff'), '店長はスタッフの名前とロール（事務へ）を変えられる');
select pg_temp.run_as(:M, $$update profiles set is_active = false where login_id = 'h-viewer'$$);
select pg_temp.ok((select not is_active from profiles where login_id = 'h-viewer'), '店長は閲覧のみの人を停止できる');

-- 2. 店長は誰かをオーナー・店長にできない
select pg_temp.expect_error(:M, $$update profiles set role = 'owner' where login_id = 'h-staff2'$$, '店長はスタッフをオーナーにできない');
select pg_temp.expect_error(:M, $$update profiles set role = 'manager' where login_id = 'h-staff2'$$, '店長はスタッフを店長にできない');
select pg_temp.expect_error(:M, $$update profiles set role = 'owner' where login_id = 'h-manager'$$, '店長は自分をオーナーにできない');

-- 3. 店長はオーナーの行に触れない
select pg_temp.expect_error(:M, $$update profiles set display_name = 'x' where login_id = 'h-owner'$$, '店長はオーナーの名前を変えられない');
select pg_temp.expect_error(:M, $$update profiles set is_active = false where login_id = 'h-owner'$$, '店長はオーナーを停止できない');
select pg_temp.expect_error(:M, $$delete from profiles where login_id = 'h-owner'$$, '店長はオーナーの行を消せない');

-- 4. 店長はオーナー・店長の行を新しく作れない（スタッフは作れる）
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-000000000011', 'h-new@test'), ('a0000000-0000-0000-0000-000000000012', 'h-new2@test');
select pg_temp.expect_error(:M, $$insert into profiles (id, login_id, display_name, role) values ('a0000000-0000-0000-0000-000000000011', 'h-new', '新', 'owner')$$, '店長はオーナーの行を作れない');
select pg_temp.run_as(:M, $$insert into profiles (id, login_id, display_name, role) values ('a0000000-0000-0000-0000-000000000012', 'h-new2', '新2', 'staff')$$);
select pg_temp.ok((select count(*) = 1 from profiles where login_id = 'h-new2'), '店長はスタッフの行を作れる');

-- 5. スタッフは今までどおり誰の行も変えられない（RLS）
select pg_temp.run_as(:S, $$update profiles set role = 'owner' where login_id = 'h-staff2'$$);
select pg_temp.ok((select role = 'staff' from profiles where login_id = 'h-staff2'), 'スタッフは他人のロールを変えられない（RLSで0行）');

-- 6. オーナーは誰でも変えられる
select pg_temp.run_as(:O, $$update profiles set role = 'manager' where login_id = 'h-staff2'$$);
select pg_temp.ok((select role = 'manager' from profiles where login_id = 'h-staff2'), 'オーナーはスタッフを店長にできる');

\echo 'ALL ACCOUNT TESTS PASSED'
rollback;
