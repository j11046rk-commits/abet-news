-- 0070 棚卸は「営業中の暇なとき」に数えてよい（店主指示 2026-11-09
--      「開店前・閉店後だと人件費が無駄になりすぎる。精度は少し落ちても、営業中の暇な時にできるように」）
--
--   timing に 'during'（営業中）を足す。営業中に数えたら、その日の営業までの在庫として扱う（as_of = 数えた日）。
--   数えたあとのその日の売上ぶんだけずれるが、毎週同じように数えれば週ごとの比べ方は変わらず、
--   ずれは翌週に持ち越されて打ち消し合う（月の合計には影響しない）。

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'cost_stocktakes'::regclass and contype = 'c'
       and (pg_get_constraintdef(oid) like '%timing%')
  loop
    execute format('alter table cost_stocktakes drop constraint %I', c.conname);
  end loop;
end $$;

alter table cost_stocktakes add constraint cost_stocktakes_timing_check
  check (timing in ('before_open', 'during', 'after_close'));
alter table cost_stocktakes add constraint cost_stocktakes_as_of_check
  check (as_of = case when timing = 'before_open' then counted_on - 1 else counted_on end);
alter table cost_stocktakes alter column timing set default 'during';
