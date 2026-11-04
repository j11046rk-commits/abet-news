-- 衛生管理（0064）の DB の守りを確かめる。**捨ててよいデータベースでだけ流すこと。**
-- 全体を1つのトランザクションで流して最後に巻き戻す（何も残さない）。
--   psql -d shippori -v ON_ERROR_STOP=1 -f supabase/tests/02-haccp.sql
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
\set S2 '''a0000000-0000-0000-0000-000000000004'''
\set V '''a0000000-0000-0000-0000-000000000005'''
\set J '''a0000000-0000-0000-0000-000000000006'''

-- 1. 計画を作れるのは店長・オーナー。スタッフ・事務・閲覧は作れない
select pg_temp.expect_error(:S, $q$insert into haccp_plans (version, status) values (1, 'draft')$q$, 'スタッフは計画の下書きを作れない');
select pg_temp.expect_error(:J, $q$insert into haccp_plans (version, status) values (1, 'draft')$q$, '事務は計画の下書きを作れない');
select pg_temp.expect_error(:M, $q$insert into haccp_plans (version, status) values (1, 'approved')$q$, '最初から承認済みでは作れない');
select pg_temp.run_as(:M, $q$insert into haccp_plans (version, status, store_name, content)
  values (1, 'draft', 'おばんざい家庭料理 しっぽり亭', '{"equipment":[{"id":"e1","name":"冷蔵庫1","kind":"fridge","maxC":10,"minC":null,"timings":["pre"]}]}')$q$);
select pg_temp.ok((select created_by from haccp_plans where version = 1) = :M, '下書きの作成者は auth.uid() から入る');
select pg_temp.expect_error(:M, $q$insert into haccp_plans (version, status) values (9, 'draft')$q$, '下書きは同時に1つだけ');

-- 2. 承認はオーナーだけ。必須項目が無いと承認できない
select pg_temp.expect_error(:M, $q$update haccp_plans set status = 'approved' where version = 1$q$, '店長は承認できない');
select pg_temp.expect_error(:O, $q$update haccp_plans set status = 'approved' where version = 1$q$, '責任者・作成者・適用開始日が無いと承認できない');
select pg_temp.run_as(:M, format($q$update haccp_plans set hygiene_manager = '責任者A', author_name = '古賀', effective_from = %L where version = 1$q$, haccp_biz_today() - 10));
select pg_temp.run_as(:O, $q$update haccp_plans set status = 'approved' where version = 1$q$);
select pg_temp.ok((select approved_by = :O and status = 'approved' from haccp_plans where version = 1), '承認者はオーナーのアカウントで自動で入る');

-- 3. 承認した計画は書き換え・削除できない
select pg_temp.expect_error(:O, $q$update haccp_plans set content = '{}' where version = 1$q$, '承認済みの計画の中身は変えられない');
select pg_temp.run_as(:O, $q$delete from haccp_plans where version = 1$q$);
select pg_temp.ok((select count(*) from haccp_plans where version = 1) = 1, '承認済みの計画は消せない（0行）');

-- 4. 周知は店長・オーナー。「読みました」は本人の分だけ
select pg_temp.expect_error(:S, format($q$insert into haccp_plan_notices (plan_id, noticed_on, method) values (%L, current_date, '朝礼')$q$, (select id from haccp_plans where version = 1)), 'スタッフは周知の記録を付けられない');
select pg_temp.run_as(:M, format($q$insert into haccp_plan_notices (plan_id, noticed_on, method) values (%L, current_date, '朝礼で読み合わせ')$q$, (select id from haccp_plans where version = 1)));
select pg_temp.run_as(:S, format($q$insert into haccp_plan_acks (plan_id) values (%L)$q$, (select id from haccp_plans where version = 1)));
select pg_temp.expect_error(:S, format($q$insert into haccp_plan_acks (plan_id, profile_id) values (%L, %L)$q$, (select id from haccp_plans where version = 1), :S2), '他人の「読みました」は押せない');

-- 5. 毎日のチェック：記録者は自動・未来は不可・過去日は実施日時が必須で「追記」になる
select pg_temp.run_as(:S, format($q$insert into haccp_checks (biz_date, check_key, plan_id, result, temp_c, criteria, note, first_result, recorded_by)
  values (%L, 'eq:e1:pre', %L, 'ng', 12.5, '{"maxC":10}', '庫内12.5℃', 'ok', %L)$q$, haccp_biz_today(), (select id from haccp_plans where version = 1), :O));
select pg_temp.ok((select recorded_by = :S and first_result = 'ng' and not entered_late from haccp_checks where check_key = 'eq:e1:pre' and biz_date = haccp_biz_today()),
  '記録者は auth.uid()（画面から別人を入れても無視）・最初の結果は DB が入れる');
select pg_temp.expect_error(:S, format($q$insert into haccp_checks (biz_date, check_key, plan_id, result, first_result, recorded_by) values (%L, 'gen:toilet:pre', %L, 'ok', 'ok', %L)$q$, haccp_biz_today() + 1, (select id from haccp_plans where version = 1), :S), '未来の日付には記録できない');
select pg_temp.expect_error(:S, format($q$insert into haccp_checks (biz_date, check_key, plan_id, result, first_result, recorded_by) values (%L, 'gen:toilet:pre', %L, 'ok', 'ok', %L)$q$, haccp_biz_today() - 1, (select id from haccp_plans where version = 1), :S), '過去日の追記は実施日時が無いと入らない');
select pg_temp.run_as(:S, format($q$insert into haccp_checks (biz_date, check_key, plan_id, result, measured_at, first_result, recorded_by) values (%L, 'gen:toilet:pre', %L, 'na', now() - interval '1 day', 'na', %L)$q$, haccp_biz_today() - 1, (select id from haccp_plans where version = 1), :S));
select pg_temp.ok((select entered_late and recorded_at > measured_at from haccp_checks where check_key = 'gen:toilet:pre'), '過去日の記録は「追記」で、実施日時と入力日時が別に残る');
select pg_temp.expect_error(:S, format($q$insert into haccp_checks (biz_date, check_key, plan_id, result, first_result, recorded_by) values (%L, 'gen:cross:close', %L, 'ng', 'ng', %L)$q$, haccp_biz_today(), (select id from haccp_plans where version = 1), :S), '「問題あり」は内容か対応が無いと入らない');
select pg_temp.expect_error(:V, format($q$insert into haccp_checks (biz_date, check_key, plan_id, result, first_result, recorded_by) values (%L, 'gen:cross:close', %L, 'ok', 'ok', %L)$q$, haccp_biz_today(), (select id from haccp_plans where version = 1), :V), '閲覧のみは記録できない');
select pg_temp.ok(pg_temp.count_as(:V, 'select * from haccp_checks') = 0, '閲覧のみは衛生管理の記録を読めない');
select pg_temp.ok(pg_temp.count_as(:J, 'select * from haccp_plans') = 0, '事務は衛生管理の計画を読めない');

-- 6. 直すときは理由が必要。最初の「問題あり」は消えず、前後が履歴に残る
select pg_temp.expect_error(:S, $q$update haccp_checks set result = 'ok', temp_c = 8 where check_key = 'eq:e1:pre'$q$, '理由なしでは直せない');
select pg_temp.run_as(:S, $q$update haccp_checks set result = 'ok', temp_c = 8, first_result = 'ok', recorded_by = 'a0000000-0000-0000-0000-000000000004', edit_reason = '打ち間違い' where check_key = 'eq:e1:pre'$q$);
select pg_temp.ok((select first_result = 'ng' and result = 'ok' and revision = 2 and recorded_by = :S and updated_by = :S from haccp_checks where check_key = 'eq:e1:pre'),
  '直しても最初の結果・記録者は変わらず、修正者と回数が入る');
select pg_temp.ok((select count(*) = 1 and bool_and(before ->> 'temp_c' = '12.5' and after ->> 'temp_c' = '8.0' and reason = '打ち間違い' and changed_by = :S)
  from haccp_revisions where table_name = 'haccp_checks'), '直す前と後・理由・修正者が履歴に残る');

-- 7. 人の記録は直せない（店長・オーナーは直せる）。記録は誰も消せない
select pg_temp.run_as(:S2, $q$update haccp_checks set note = '書き換え', edit_reason = 'x' where check_key = 'eq:e1:pre'$q$);
select pg_temp.ok((select note is distinct from '書き換え' from haccp_checks where check_key = 'eq:e1:pre'), '他のスタッフの記録は直せない（0行）');
select pg_temp.run_as(:M, $q$update haccp_checks set note = '店長が補足', edit_reason = '補足' where check_key = 'eq:e1:pre'$q$);
select pg_temp.ok((select note = '店長が補足' from haccp_checks where check_key = 'eq:e1:pre'), '店長は直せる');
select pg_temp.run_as(:O, $q$delete from haccp_checks$q$);
select pg_temp.ok((select count(*) from haccp_checks) = 2, 'オーナーでも記録は消せない（0行）');

-- 8. 計画を変えても、過去の記録は当時の版と基準のまま
select pg_temp.run_as(:M, format($q$insert into haccp_plans (version, status, store_name, hygiene_manager, author_name, effective_from, change_reason, content)
  values (2, 'draft', 'しっぽり亭', '責任者A', '古賀', %L, '冷蔵庫の基準を5℃に', '{"equipment":[{"id":"e1","name":"冷蔵庫1","kind":"fridge","maxC":5,"minC":null,"timings":["pre"]}]}')$q$, haccp_biz_today() - 20));
select pg_temp.expect_error(:O, $q$update haccp_plans set status = 'approved' where version = 2$q$, '前の版より前の適用開始日では承認できない');
select pg_temp.run_as(:M, format($q$update haccp_plans set effective_from = %L where version = 2$q$, haccp_biz_today() + 1));
select pg_temp.run_as(:O, $q$update haccp_plans set status = 'approved' where version = 2$q$);
select pg_temp.ok((select status from haccp_plans where version = 1) = 'superseded', '新しい版を承認すると前の版は「置き換え済み」になる');
select pg_temp.ok((select p.version = 1 and c.criteria ->> 'maxC' = '10' from haccp_checks c join haccp_plans p on p.id = c.plan_id where c.check_key = 'eq:e1:pre'),
  '過去の記録は第1版と当時の基準（10℃）に結び付いたまま');
select pg_temp.run_as(:M, $q$update haccp_checks set criteria = '{"maxC":5}', edit_reason = '新基準' where check_key = 'eq:e1:pre'$q$);
select pg_temp.ok((select criteria ->> 'maxC' = '10' from haccp_checks where check_key = 'eq:e1:pre'), '記録の基準は10℃のまま');
select pg_temp.expect_error(:S, format($q$insert into haccp_checks (biz_date, check_key, plan_id, result, first_result, recorded_by) values (%L, 'x', (select id from haccp_plans where version = 3), 'ok', 'ok', %L)$q$, haccp_biz_today(), :S), '承認されていない計画には記録を結び付けられない');

-- 9. 異常と改善：スタッフは記録・対応を入れられるが、対応済みにするのは店長・オーナー
select pg_temp.run_as(:S, format($q$insert into haccp_incidents (biz_date, occurred_at, category, target, problem, created_by) values (%L, now(), 'temp', '冷蔵庫1', '12.5℃', %L)$q$, haccp_biz_today(), :S));
select pg_temp.expect_error(:S, $q$update haccp_incidents set status = 'done', action = '扉を閉めた', recheck_result = 'ok'$q$, 'スタッフは対応済みにできない');
select pg_temp.expect_error(:M, $q$update haccp_incidents set status = 'done'$q$, '対応を書かずに対応済みにはできない');
select pg_temp.expect_error(:M, $q$update haccp_incidents set status = 'done', action = '扉を閉めた', recheck_result = 'ng'$q$, '再確認が「問題あり」のままでは対応済みにできない');
select pg_temp.run_as(:M, $q$update haccp_incidents set status = 'done', action = '扉を閉めた', recheck_at = now(), recheck_result = 'ok'$q$);
select pg_temp.ok((select confirmer_id = :M and confirmed_at is not null and created_by = :S from haccp_incidents), '確認者は対応済みにした店長で入る・記録者は変わらない');
select pg_temp.expect_error(:S, format($q$insert into haccp_incidents (biz_date, occurred_at, target, problem, status, created_by) values (%L, now(), 'x', 'y', 'done', %L)$q$, haccp_biz_today(), :S), '最初から対応済みでは作れない');

-- 10. 仕込みの記録：空欄を埋めるのは理由なしでよい。入れた値を変えるのは理由が要る
select pg_temp.run_as(:S, format($q$insert into haccp_batches (biz_date, plan_id, menu_id, item_name, cc_group, variant, vals, judgement, recorded_by)
  values (%L, (select id from haccp_plans where version = 1), 'm1', '肉じゃが', 'g3', 'reheat', '{"cool":{"startAt":"2026-11-04T06:00:00Z"}}', 'pending', %L)$q$, haccp_biz_today(), :S));
select pg_temp.run_as(:S2, $q$update haccp_batches set vals = '{"cool":{"startAt":"2026-11-04T06:00:00Z","endAt":"2026-11-04T06:25:00Z","endTempC":18}}', judgement = 'ok'$q$);
select pg_temp.ok((select revision = 2 and updated_by = :S2 from haccp_batches), '冷却の終わりは別の人が続けて入れられる（理由なし・更新者が残る）');
select pg_temp.expect_error(:S, $q$update haccp_batches set vals = '{"cool":{"startAt":"2026-11-04T05:00:00Z","endAt":"2026-11-04T06:25:00Z","endTempC":18}}'$q$, '入れた値を理由なしで変えられない');
select pg_temp.run_as(:S, $q$update haccp_batches set judgement = 'ng', vals = vals || '{"chill":{"tempC":14}}'$q$);
select pg_temp.run_as(:S, $q$update haccp_batches set judgement = 'ok', vals = '{"cool":{"startAt":"2026-11-04T06:00:00Z","endAt":"2026-11-04T06:25:00Z","endTempC":18},"chill":{"tempC":4}}', edit_reason = '測り直し'$q$);
select pg_temp.ok((select first_ng_at is not null and judgement = 'ok' from haccp_batches), '一度基準外になった事実（first_ng_at）は、直しても消えない');

-- 11. 週の確認・月の振り返りは店長・オーナー
select pg_temp.expect_error(:S, format($q$insert into haccp_reviews (kind, period_start, period_end, reviewer_id) values ('week', %L, %L, %L)$q$, current_date, current_date + 6, :S), 'スタッフは振り返りを付けられない');
select pg_temp.run_as(:M, format($q$insert into haccp_reviews (kind, period_start, period_end, comment, reviewer_id) values ('week', %L, %L, '確認した', %L)$q$, current_date, current_date + 6, :O));
select pg_temp.ok((select reviewer_id = :M from haccp_reviews), '確認者は auth.uid()（店長）で入る');

-- 12. 日締め：未来は不可・締めた人が入る
select pg_temp.expect_error(:S, format($q$insert into haccp_day_closes (biz_date, closed_by) values (%L, %L)$q$, haccp_biz_today() + 1, :S), '未来の日は締められない');
select pg_temp.run_as(:S, format($q$insert into haccp_day_closes (biz_date, closed_by, missing_count) values (%L, %L, 3)$q$, haccp_biz_today() - 1, :O));
select pg_temp.ok((select closed_by = :S and entered_late from haccp_day_closes), '前の営業日を締めた人は本人・翌営業日以降なら追記扱い');

-- 13. 未ログイン(anon)は何も読めない
set local role anon;
do $$ begin
  perform 1 from haccp_checks;
  raise exception 'FAIL: anon が読めた';
exception when insufficient_privilege then raise notice 'PASS: 未ログインは衛生管理の表を読めない';
end $$;
reset role;

-- 14. 営業日の境目（日本時間の朝4時）
select pg_temp.ok(((timestamptz '2026-11-05 03:59+09' at time zone 'Asia/Tokyo') - interval '4 hours')::date = date '2026-11-04'
  and ((timestamptz '2026-11-05 04:00+09' at time zone 'Asia/Tokyo') - interval '4 hours')::date = date '2026-11-05',
  '深夜0〜4時は前の営業日として扱う式');

\echo 'ALL HACCP TESTS PASSED'
rollback;
