-- 原価（0065）の DB の守りを確かめる。**捨ててよいデータベースでだけ流すこと。**
-- 全体を1つのトランザクションで流して最後に巻き戻す（何も残さない）。
--   psql -d shippori -v ON_ERROR_STOP=1 -f supabase/tests/03-cost.sql
-- 「PASS:」が並び、最後に「ALL COST TESTS PASSED」が出れば合格。1つでも外れると FAIL で止まる。
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

-- 1. 仕入を入れられるのはオーナー・店長・事務。スタッフ・閲覧は入れられない
select pg_temp.run_as(:O, $$insert into cost_purchases (book_date, vendor, doc_kind, food_ex) values ('2026-11-03', '丸魚', 'slip', 12000)$$);
select pg_temp.run_as(:M, $$insert into cost_purchases (book_date, vendor, doc_kind, drink_ex) values ('2026-11-04', '酒屋', 'receipt', 8000)$$);
select pg_temp.run_as(:J, $$insert into cost_purchases (book_date, vendor, doc_kind, supplies_ex) values ('2026-11-05', 'スーパー', 'receipt', 1500)$$);
select pg_temp.expect_error(:S, $$insert into cost_purchases (book_date, vendor, doc_kind, food_ex) values ('2026-11-05', 'x', 'slip', 1)$$, 'スタッフは仕入を入れられない');
select pg_temp.expect_error(:V, $$insert into cost_purchases (book_date, vendor, doc_kind, food_ex) values ('2026-11-05', 'x', 'slip', 1)$$, '閲覧のみは仕入を入れられない');

-- 2. 読めるのも同じ3者だけ（スタッフ・閲覧には0行）
select pg_temp.ok(pg_temp.count_as(:J, 'select * from cost_purchases') = 3, '事務は仕入を読める');
select pg_temp.ok(pg_temp.count_as(:S, 'select * from cost_purchases') = 0, 'スタッフには仕入が見えない');
select pg_temp.ok(pg_temp.count_as(:V, 'select * from cost_losses') = 0, '閲覧のみにはロスが見えない');
select pg_temp.ok(pg_temp.count_as(null, 'select * from cost_stock_items') = 0, '未ログインには何も見えない');

-- 3. 作った人は自動で入り、直しても書き換わらない。直した人も自動で入る
select pg_temp.ok((select created_by from cost_purchases where vendor = '丸魚') = :O::uuid, '作った人が自動で入る');
select pg_temp.run_as(:M, $$update cost_purchases set food_ex = 13000, created_by = 'a0000000-0000-0000-0000-000000000002' where vendor = '丸魚'$$);
select pg_temp.ok((select created_by from cost_purchases where vendor = '丸魚') = :O::uuid, '作った人は書き換えられない');
select pg_temp.ok((select updated_by from cost_purchases where vendor = '丸魚') = :M::uuid, '直した人が自動で入る');

-- 4. 書類の種類・期間・金額の検査
select pg_temp.expect_error(:O, $$insert into cost_purchases (book_date, vendor, doc_kind) values ('2026-11-05', '  ', 'slip')$$, '業者名が空は不可');
select pg_temp.expect_error(:O, $$insert into cost_purchases (book_date, vendor, doc_kind) values ('2026-11-05', 'x', 'memo')$$, '書類の種類は3つだけ');
select pg_temp.expect_error(:O, $$insert into cost_purchases (book_date, vendor, doc_kind, period_from, period_to) values ('2026-11-30', 'x', 'invoice', '2026-11-30', '2026-11-01')$$, '請求期間が逆は不可');

-- 5. 棚卸：数えて確定すると、その月の数は直せない。確定を外せば直せる
select pg_temp.run_as(:M, $$insert into cost_stock_items (name, unit, unit_price) values ('ぶり', '本', 4000)$$);
select pg_temp.run_as(:M, $$insert into cost_stocktakes (ym) values ('2026-11')$$);
select pg_temp.run_as(:M, $$insert into cost_stock_counts (ym, item_id, qty, unit_price) select '2026-11', id, 2.5, unit_price from cost_stock_items where name = 'ぶり'$$);
select pg_temp.expect_error(:M, $$update cost_stocktakes set status = 'done' where ym = '2026-11'$$, '在庫額なしでは確定できない');
select pg_temp.run_as(:M, $$update cost_stocktakes set status = 'done', total_ex = 10000 where ym = '2026-11'$$);
select pg_temp.expect_error(:O, $$update cost_stock_counts set qty = 3 where ym = '2026-11'$$, '確定した棚卸の数は直せない');
select pg_temp.expect_error(:O, $$delete from cost_stock_counts where ym = '2026-11'$$, '確定した棚卸の数は消せない');
select pg_temp.run_as(:O, $$update cost_stocktakes set status = 'draft', total_ex = null where ym = '2026-11'$$);
select pg_temp.run_as(:O, $$update cost_stock_counts set qty = 3 where ym = '2026-11'$$);
select pg_temp.ok((select qty from cost_stock_counts where ym = '2026-11') = 3, '確定を外せば直せる');
select pg_temp.expect_error(:S, $$insert into cost_stocktakes (ym) values ('2026-12')$$, 'スタッフは棚卸を始められない');
select pg_temp.expect_error(:O, $$insert into cost_stocktakes (ym) values ('2026-13')$$, '月の形が不正なら不可');
select pg_temp.expect_error(:O, $$insert into cost_stock_counts (ym, item_id, qty, unit_price) select '2026-11', id, -1, 1 from cost_stock_items limit 1$$, '数はマイナス不可');

-- 6. ロス
select pg_temp.run_as(:J, $$insert into cost_losses (biz_date, item, amount_ex, reason) values ('2026-11-05', 'ぶり 半身', 2000, 'expired')$$);
select pg_temp.expect_error(:J, $$insert into cost_losses (biz_date, item, amount_ex, reason) values ('2026-11-05', 'x', 1, 'lazy')$$, 'ロスの理由は決めた中から');
select pg_temp.expect_error(:S, $$insert into cost_losses (biz_date, item, amount_ex, reason) values ('2026-11-05', 'x', 1, 'expired')$$, 'スタッフはロスを入れられない');

-- 7. 写真の置き場は非公開
select pg_temp.ok((select not public from storage.buckets where id = 'cost-photos'), '写真の置き場は非公開');

\echo 'ALL COST TESTS PASSED'
rollback;
