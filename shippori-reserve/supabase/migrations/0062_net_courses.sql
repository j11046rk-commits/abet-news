-- 0062 ネット予約でコースを選べるように（店主要望 2026-11-03・忘年会・新年会プラン）
--
-- net_until … ネット予約で選べる最後の来店日。null のコースはネットでは選べない（店内だけ）。
-- 「前日までのご予約に限る」「何名様から（min_party）」は画面とサーバーの両方で見る。
alter table courses add column if not exists net_until date;

insert into courses (name, price_yen, includes_drink, min_party, note, sort_order, is_active, net_until)
select v.name, v.price, false, 4, '＋2,000円（税込）で100分飲み放題。4名様より・前日までにご予約', v.sort, true, date '2027-01-31'
from (values
  ('博多水炊きコース', 4000, 1),
  ('もつ鍋コース',     4500, 2),
  ('すき焼きコース',   5000, 3)
) as v(name, price, sort)
where not exists (select 1 from courses c where c.name = v.name);
