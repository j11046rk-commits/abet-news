\set ON_ERROR_STOP off
\timing off
\pset pager off

-- ── 検証用のスタッフを3人つくる（本番は seed-accounts.mjs / 発行API が行う）──
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'koga@shipporitei.local'),
  ('22222222-2222-2222-2222-222222222222', 'ando@shipporitei.local'),
  ('33333333-3333-3333-3333-333333333333', 'mise@shipporitei.local');

insert into profiles (id, login_id, display_name, role, is_owner_contact, must_change_password) values
  ('11111111-1111-1111-1111-111111111111', 'koga', '古賀 龍馬', 'owner',  true,  false),
  ('22222222-2222-2222-2222-222222222222', 'ando', '安藤 正',   'staff',  false, false),
  ('33333333-3333-3333-3333-333333333333', 'mise', '見る人',     'viewer', false, false);

\echo '───── 1. 未ログイン(anon)は予約を1件も読めない ─────'
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select 'NG: anon が読めてしまった' from reservations limit 1;
\echo '（上に何も出なければ拒否されている／権限エラーが出ればそれも拒否）'
reset role;

\echo '───── 2. staff は予約を登録できる。営業日と受付番号が自動で埋まる ─────'
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);

insert into reservations (biz_date, starts_at, ends_at, party_size, customer_name, phone, source, status, created_by)
values ('2026-08-14', '2026-08-14 09:00:00+00', '2026-08-14 11:00:00+00', 4, '田中', '090-0000-0000', 'phone', 'confirmed', '22222222-2222-2222-2222-222222222222');

select reference, biz_date, party_size, status from reservations where customer_name = '田中';
select biz_date, mode, is_closed, open_min, close_min from business_days where biz_date = '2026-08-14';
\echo '（8/14は金曜なので close_min=1500＝25:00 になっていること）'

\echo '───── 3. 流入元「オーナー直接」は、誰経由かが無いと保存できない ─────'
insert into reservations (biz_date, starts_at, ends_at, party_size, customer_name, source)
values ('2026-08-14', '2026-08-14 10:00:00+00', '2026-08-14 12:00:00+00', 2, '佐藤', 'owner_direct');
\echo '（↑ reservations_owner_direct_needs_person 違反になるのが正解）'

\echo '───── 4. キャンセルは理由が無いと保存できない ─────'
update reservations set status = 'cancelled' where customer_name = '田中';
\echo '（↑ reservations_cancel_reason 違反になるのが正解）'

update reservations set status = 'cancelled', cancel_reason = 'お客様都合' where customer_name = '田中';
select status, cancel_reason, cancelled_at is not null as stamped from reservations where customer_name = '田中';

\echo '───── 5. staff は自分のロールを owner に書き換えられない ─────'
update profiles set role = 'owner' where id = '22222222-2222-2222-2222-222222222222';
select login_id, role from profiles where login_id = 'ando';
\echo '（role が staff のままであること）'

\echo '───── 6. staff は採番カウンタを直接触れない ─────'
select * from reference_counters;
\echo '（0行または権限エラーが正解）'

\echo '───── 7. viewer は予約を登録できない ─────'
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
insert into reservations (biz_date, starts_at, ends_at, party_size, customer_name, source)
values ('2026-08-15', '2026-08-15 09:00:00+00', '2026-08-15 11:00:00+00', 2, '鈴木', 'line');
\echo '（↑ RLS で拒否されるのが正解）'
select count(*) as viewer_can_read from reservations;
\echo '（viewer は読めるので 1 になる）'

\echo '───── 8. viewer は営業日を変更できない ─────'
update business_days set is_busy = true where biz_date = '2026-08-14';
\echo '（0行更新＝拒否が正解）'

\echo '───── 9. owner はイベント営業日に切り替えられる。定員が無いと拒否される ─────'
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
insert into business_days (biz_date, mode, close_min) values ('2026-08-16', 'event', 1500);
\echo '（↑ business_days_event_needs_capacity 違反になるのが正解）'

insert into business_days (biz_date, mode, event_capacity, close_min)
values ('2026-08-16', 'event', 60, 1500);

insert into reservations (biz_date, starts_at, ends_at, party_size, customer_name, source, status, created_by)
values ('2026-08-16', '2026-08-16 09:00:00+00', '2026-08-16 11:00:00+00', 18, '山本', 'line', 'confirmed', '11111111-1111-1111-1111-111111111111');

select biz_date, mode, reservation_count, guest_count, remaining_capacity
from v_daily_summary where biz_date in ('2026-08-14','2026-08-16') order by biz_date;
\echo '（8/14はキャンセル済なので guest_count=0 / 8/16は 18名で残り42）'

\echo '───── 10. 監査ログに変更が残っている ─────'
select action, target_table, target_id is not null as has_target
from audit_logs where target_table = 'reservations' order by id;

\echo '───── 11. 流入元別の集計が引ける ─────'
select source, total, guests from v_source_stats order by source;

reset role;
\echo '───── 検証おわり ─────'
