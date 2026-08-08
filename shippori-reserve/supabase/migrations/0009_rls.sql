-- 0009 行レベルセキュリティ
-- docs/03-database.md §3-11 に対応（Phase 1 のテーブルぶん）。
--
-- 方針：アプリを信用しない。アプリのバグでURLを直接叩かれても、DBが拒否する。

alter table profiles           enable row level security;
alter table permissions        enable row level security;
alter table role_permissions   enable row level security;
alter table seat_units         enable row level security;
alter table courses            enable row level security;
alter table settings           enable row level security;
alter table business_days      enable row level security;
alter table reservations       enable row level security;
alter table reference_counters enable row level security;
alter table audit_logs         enable row level security;

-- 未ログイン（anon）には一切与えない。
-- 公開予約フォーム（Phase 3）はサーバー側の service_role 経由でのみ書き込む。
revoke all on all tables in schema public from anon;

grant select on permissions, role_permissions, seat_units, courses, settings to authenticated;
grant select, insert, update on business_days to authenticated;
grant select, insert, update on reservations  to authenticated;
grant select, insert, update on profiles      to authenticated;
grant select on audit_logs to authenticated;

-- ── スタッフ ────────────────────────────────────────────────
drop policy if exists profiles_select_self on profiles;
create policy profiles_select_self on profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists profiles_select_all on profiles;
create policy profiles_select_all on profiles
  for select to authenticated using (is_active_user());

drop policy if exists profiles_write on profiles;
create policy profiles_write on profiles
  for all to authenticated
  using (has_permission('account.write'))
  with check (has_permission('account.write'));

-- 「自分の行なら更新できる」ポリシーは置かない。
-- RLS は列を絞れないので、それを許すと一般スタッフが自分の role を owner に書き換えられる。
-- 初回パスワード変更で must_change_password を false にするのは、
-- サーバー側の API（service_role）が行う（src/app/api/auth/password/route.ts）。

-- ── 権限マスタ（読むだけ）───────────────────────────────────
drop policy if exists permissions_select on permissions;
create policy permissions_select on permissions
  for select to authenticated using (is_active_user());

drop policy if exists role_permissions_select on role_permissions;
create policy role_permissions_select on role_permissions
  for select to authenticated using (is_active_user());

-- ── 予約 ────────────────────────────────────────────────────
drop policy if exists reservations_select on reservations;
create policy reservations_select on reservations
  for select to authenticated using (is_active_user() and has_permission('reservation.read'));

drop policy if exists reservations_insert on reservations;
create policy reservations_insert on reservations
  for insert to authenticated with check (has_permission('reservation.write'));

drop policy if exists reservations_update on reservations;
create policy reservations_update on reservations
  for update to authenticated
  using (has_permission('reservation.write'))
  with check (has_permission('reservation.write'));

-- DELETE は誰にも許可しない。キャンセルは status の変更として残す。

-- ── 営業日 ──────────────────────────────────────────────────
drop policy if exists business_days_select on business_days;
create policy business_days_select on business_days
  for select to authenticated using (is_active_user());

drop policy if exists business_days_write on business_days;
create policy business_days_write on business_days
  for all to authenticated
  using (has_permission('businessday.write'))
  with check (has_permission('businessday.write'));

-- 予約を入れると ensure_business_day() が行を作る。
-- あの関数は security definer なので、予約担当者に businessday.write は要らない。

-- ── マスタ ──────────────────────────────────────────────────
drop policy if exists seat_units_select on seat_units;
create policy seat_units_select on seat_units
  for select to authenticated using (is_active_user());

drop policy if exists seat_units_write on seat_units;
create policy seat_units_write on seat_units
  for all to authenticated
  using (has_permission('settings.write'))
  with check (has_permission('settings.write'));

drop policy if exists courses_select on courses;
create policy courses_select on courses
  for select to authenticated using (is_active_user());

drop policy if exists courses_write on courses;
create policy courses_write on courses
  for all to authenticated
  using (has_permission('settings.write'))
  with check (has_permission('settings.write'));

drop policy if exists settings_select on settings;
create policy settings_select on settings
  for select to authenticated using (is_active_user());

drop policy if exists settings_write on settings;
create policy settings_write on settings
  for all to authenticated
  using (has_permission('settings.write'))
  with check (has_permission('settings.write'));

-- ── 採番カウンタ ────────────────────────────────────────────
-- ポリシーを1つも作らない＝誰も直接触れない。
-- 採番は assign_reference()（security definer）の中でだけ起きる。

-- ── 監査ログ ────────────────────────────────────────────────
-- 読むだけ。書き込みは security definer のトリガのみ。誰も書き換えられない。
drop policy if exists audit_select on audit_logs;
create policy audit_select on audit_logs
  for select to authenticated using (has_permission('audit.read'));
