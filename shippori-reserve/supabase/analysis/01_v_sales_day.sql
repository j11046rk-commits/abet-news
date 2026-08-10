-- 01 日次売上に「読むための列」を足した土台ビュー
--
-- sales_daily は (biz_date, target_yen, actual_yen) しか無いので、
-- 曜日・祝日・祝日の前日・お盆・年末・営業日設定を毎回 join し直すことになる。
-- そこを1枚にまとめる。以降の分析はすべてこのビューを引く。
--
-- ★このビューの一番大事な仕事は「火曜フラグ」。
--   2026-03-31 を最後に火曜定休になった（それ以前は火曜も営業していた）。
--   火曜を混ぜたまま前年と比べると、2026年が構造的に低く出る。
--   比較のときは必ず is_tuesday = false で絞る。
--
-- ★もう一つの要は dine_in_yen（店内飲食だけの売上）。
--   太巻きのような物販が1日で62万乗ると、その日は通常営業の5日分になり、
--   平均も前年比も達成率も全部そこに引きずられる。店の実力を見るときは
--   actual_yen ではなく dine_in_yen を使う。
--
-- 列を足すときは置き換えではなく作り直しになる（drop view → create view）。
-- migrations/0030・0031 がこのビューを同じ定義で作り直しているので、
-- 直すときは両方を揃えること。

drop view if exists v_sales_day;
create view v_sales_day with (security_invoker = true) as
select
  s.biz_date,
  extract(dow from s.biz_date)::int                       as dow,
  (array['日','月','火','水','木','金','土'])[extract(dow from s.biz_date)::int + 1] as dow_ja,
  to_char(s.biz_date, 'YYYY-MM')                          as ym,
  extract(year  from s.biz_date)::int                     as yy,
  extract(month from s.biz_date)::int                     as mm,
  extract(day   from s.biz_date)::int                     as dd,
  s.target_yen,
  s.actual_yen,

  -- 税率で分けた売上（エアレジの税率別集計、または手入力の「うち物販」から）
  s.tax10_yen,
  s.tax8_yen,
  -- 店内飲食だけ。10%が来ていればそれを、無ければ「実績 − 物販」を使う
  coalesce(s.tax10_yen, s.actual_yen - coalesce(s.tax8_yen, 0)) as dine_in_yen,
  coalesce(s.tax8_yen, 0)                                       as retail_yen,
  (s.tax8_yen is not null and s.tax8_yen > 0)                   as has_retail,

  -- 曜日の区分
  (extract(dow from s.biz_date)::int = 2)                 as is_tuesday,
  (extract(dow from s.biz_date)::int in (5,6))            as is_fri_sat,

  -- 祝日まわり
  h.name                                                  as holiday_name,
  (h.name is not null)                                    as is_holiday,
  hn.name                                                 as next_holiday_name,
  (hn.name is not null)                                   as is_holiday_eve,
  -- 「客にとって翌日が休み」＝翌日が土日または祝日
  (extract(dow from s.biz_date + 1)::int in (0,6) or hn.name is not null) as tomorrow_off,

  -- 季節の箱
  (to_char(s.biz_date,'MM-DD') between '08-11' and '08-16')          as is_obon,
  (extract(month from s.biz_date)::int = 12
     and extract(day from s.biz_date)::int >= 10)                     as is_bounenkai,
  (to_char(s.biz_date,'MM-DD') between '10-16' and '10-18')          as is_taiko_matsuri,

  -- 営業日設定（行が無い日が普通なので left join。null は「未設定」）
  b.mode, b.is_busy, b.is_closed, b.event_name, b.open_min, b.close_min
from sales_daily s
left join jp_holidays h  on h.d = s.biz_date
left join jp_holidays hn on hn.d = s.biz_date + 1
left join business_days b on b.biz_date = s.biz_date;

grant select on v_sales_day to authenticated;
revoke all on v_sales_day from anon;
