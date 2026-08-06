-- ============================================================
-- The Oldmans — スキーマ回帰検証（ローカル Postgres 16 用）
-- ============================================================
-- 目的：setup.sql が「1回ペースト」で通り、RLS・トリガ・ビューが
--       実データで意図どおり動くことを、実 Supabase なしで確かめる。
--       HANDOFF §3 の「実 Supabase との往復」のうち DB 層をここで担保する。
--
-- 使い方（まっさらなスクラッチDBで実行する。本番DBには流さない）：
--
--   dropdb --if-exists oldman_verify && createdb oldman_verify
--   psql -d oldman_verify -v ON_ERROR_STOP=1 -f supabase/verify.sql
--
--   全チェックが通れば最後に「ALL CHECKS PASSED」と出て exit 0。
--   1つでも壊れていれば raise exception で止まり exit 3 になる。
--
-- 構成：
--   (1) Supabase の auth スキーマ最小スタブ（README.md 準拠）
--   (2) \ir で supabase/setup.sql を丸ごと適用
--   (3) フィクスチャを入れて 11 チェック。最後に ROLLBACK して痕跡を残さない
--       （auth スタブと setup.sql の構造だけがDBに残る）
-- ============================================================


-- ── (1) auth スキーマの最小スタブ ───────────────────────────
create schema if not exists auth;
create extension if not exists "pgcrypto";
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls; end if;
end $$;
grant usage on schema public, auth to anon, authenticated, service_role;


-- ── (2) 本番と同じ setup.sql を適用（このファイルからの相対パス）──
\ir setup.sql


-- ── (3) 検証 ────────────────────────────────────────────────
-- 固定UUID（読みやすさのため）
--   owner  = ...0001  santiago
--   member = ...0002  manolin
--   issued = ...0003  pedrico（owner が発行 / 途中で無効化）
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001','santiago@theoldman.local'),
  ('00000000-0000-0000-0000-000000000002','manolin@theoldman.local'),
  ('00000000-0000-0000-0000-000000000003','pedrico@theoldman.local');
insert into profiles (id, login_id, display_name, role, investment_yen, must_change_password) values
  ('00000000-0000-0000-0000-000000000001','santiago','サンチャゴ','owner', 500000, true),
  ('00000000-0000-0000-0000-000000000002','manolin','マノーリン','member',100000, true);

do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-000000000001';
  memb_id  uuid := '00000000-0000-0000-0000-000000000002';
  new_id   uuid := '00000000-0000-0000-0000-000000000003';
  sid uuid;
  n integer;
  v integer;
begin
  -- 認証ロールで member として振る舞うヘルパ的な set は各ブロックで行う

  -- 1) member のセッション記録 → 台帳にレーキ行が自動起票（DBトリガ）
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
  insert into sessions (started_at, ended_at, game_type, rake_yen, created_by)
  values (now() - interval '2 hours', now(), 'cash', 8000, memb_id)
  returning id into sid;
  select amount_yen into v from ledger_entries where session_id = sid and category='rake';
  if v is distinct from 8000 then raise exception 'CHECK 1 FAIL: レーキ自動起票=%（期待8000）', v; end if;
  raise notice 'CHECK 1 PASS: セッション記録→台帳レーキ自動起票 (%円)', v;

  -- 2) member が手動記帳できる（0006で全員に開放・session_id is null）
  insert into ledger_entries (direction, category, amount_yen, memo, created_by)
  values ('expense','消耗品',1200,'トランプ補充', memb_id);
  select count(*) into n from ledger_entries where category='消耗品';
  if n <> 1 then raise exception 'CHECK 2 FAIL: member 手動記帳ができない'; end if;
  raise notice 'CHECK 2 PASS: member が手動記帳できる';

  -- 3) セッション由来行（session_id 有）は member が直接いじれない
  update ledger_entries set amount_yen = 999999 where session_id = sid and category='rake';
  select amount_yen into v from ledger_entries where session_id = sid and category='rake';
  if v <> 8000 then raise exception 'CHECK 3 FAIL: セッション由来のレーキ行を書き換えられた (%)', v; end if;
  raise notice 'CHECK 3 PASS: セッション由来行は台帳から書き換え不可';

  -- 4) 施設設定は owner 限定（member は書けない）
  update settings set monthly_target_yen = 1 where id;
  select monthly_target_yen into v from settings;
  if v <> 100000 then raise exception 'CHECK 4 FAIL: member が施設設定を変更できた (%)', v; end if;
  raise notice 'CHECK 4 PASS: 施設設定は member から変更不可';

  -- 5) member は自分を owner に昇格できない（guard トリガ）
  update profiles set role='owner', investment_yen=9999999 where id = memb_id;
  select investment_yen into v from profiles where id = memb_id;
  if (select role from profiles where id = memb_id) <> 'member' or v <> 100000 then
    raise exception 'CHECK 5 FAIL: ロール昇格を防げなかった'; end if;
  raise notice 'CHECK 5 PASS: 自己ロール昇格を guard トリガが阻止';

  -- 6) owner は設定・固定費を編集できる
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
  update settings set monthly_target_yen = 120000 where id;
  insert into fixed_costs (name, amount_yen, billing_day) values ('保険', 3000, 10);
  select monthly_target_yen into v from settings;
  select count(*) into n from fixed_costs;
  if v <> 120000 or n <> 3 then raise exception 'CHECK 6 FAIL: owner が設定/固定費を編集できない'; end if;
  raise notice 'CHECK 6 PASS: owner は設定・固定費を編集できる';

  -- 7) 予約制約：非正時を拒否 / other はメモ必須 / 正常な貸切は登録可
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
  begin
    insert into reservations (starts_at, ends_at, created_by)
    values (date_trunc('hour', now()) + interval '30 min',
            date_trunc('hour', now()) + interval '90 min', memb_id);
    raise exception 'CHECK 7 FAIL: 非正時の予約が通った';
  exception when check_violation then null; end;
  begin
    insert into reservations (purposes, starts_at, ends_at, created_by)
    values ('{other}', date_trunc('hour', now()) + interval '1 hour',
            date_trunc('hour', now()) + interval '2 hours', memb_id);
    raise exception 'CHECK 7 FAIL: 用途 other でメモ無しが通った';
  exception when check_violation then null; end;
  insert into reservations (title, purposes, is_exclusive, starts_at, ends_at, headcount, created_by)
  values ('貸切テスト','{private}', true,
          date_trunc('hour', now()) + interval '3 hours',
          date_trunc('hour', now()) + interval '6 hours', 4, memb_id);
  raise notice 'CHECK 7 PASS: 予約制約（正時・otherメモ必須）と正常な貸切登録';

  -- 8) rake 更新→台帳追従 / セッション削除→レーキ行も消える
  reset role;   -- superuser（RLSバイパス）で親テーブルを操作
  update sessions set rake_yen = 5000 where id = sid;
  select amount_yen into v from ledger_entries where session_id = sid and category='rake';
  if v <> 5000 then raise exception 'CHECK 8 FAIL: rake 更新が台帳に追従しない (%)', v; end if;
  delete from sessions where id = sid;
  select count(*) into n from ledger_entries where session_id = sid and category='rake';
  if n <> 0 then raise exception 'CHECK 8 FAIL: セッション削除でレーキ行が残った (%)', n; end if;
  raise notice 'CHECK 8 PASS: rake更新は台帳追従・セッション削除でレーキ行も消える';

  -- 9) ビューが集計できる（貸切3.0h・支出1200が反映される）
  select exclusive_hours::text::numeric into v from v_exclusive_hours limit 1;
  if (select round(exclusive_hours,1) from v_exclusive_hours limit 1) <> 3.0 then
    raise exception 'CHECK 9 FAIL: v_exclusive_hours の貸切時間が想定外'; end if;
  if (select expense_yen from v_monthly_summary order by ym desc limit 1) <> 1200 then
    raise exception 'CHECK 9 FAIL: v_monthly_summary の支出が想定外'; end if;
  raise notice 'CHECK 9 PASS: 各ビューが集計できる';

  -- 10) アカウント発行は owner のみ（member 不可）
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';  -- member
  begin
    insert into profiles (id, login_id, display_name, role)
    values (new_id, 'pedrico', 'ペドリコ', 'member');
    raise exception 'CHECK 10 FAIL: member がアカウント発行できた';
  exception when insufficient_privilege then null; end;
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';  -- owner
  insert into profiles (id, login_id, display_name, role)
  values (new_id, 'pedrico', 'ペドリコ', 'member');
  if not exists (select 1 from profiles where id = new_id) then
    raise exception 'CHECK 10 FAIL: owner がアカウント発行できない'; end if;
  raise notice 'CHECK 10 PASS: アカウント発行は owner のみ可';

  -- 11) is_active=false は読みも書きも締め出し
  reset role;
  update profiles set is_active=false where id = new_id;
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';  -- 無効化された pedrico
  select count(*) into n from profiles where id <> new_id;
  if n <> 0 then raise exception 'CHECK 11 FAIL: 無効アカウントに他人の profiles が見えた (%)', n; end if;
  begin
    insert into ledger_entries (direction, category, amount_yen, created_by)
    values ('expense','test',100, new_id);
    raise exception 'CHECK 11 FAIL: 無効アカウントが記帳できた';
  exception when insufficient_privilege then null; end;
  raise notice 'CHECK 11 PASS: is_active=false は読みも書きも締め出し';

  reset role;
  raise notice '==================================================';
  raise notice 'ALL CHECKS PASSED (1-11)';
  raise notice '==================================================';
end $$;

-- フィクスチャは残さない（構造だけをスクラッチDBに残す）
rollback;
