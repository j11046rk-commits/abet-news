-- 03 2026年8月の調査で実際に流したクエリ
--
-- 居酒屋で使われている指標を調べたうえで、894日分の売上に当ててみた結果。
-- 結論は docs/08-指標の仕分け.md に書いた。ここには「どう出したか」を残す。
--
-- 全部 v_sales_day（analysis/01）を前提にしている。先にそちらを流すこと。
-- 比較はすべて火曜を除く。2026年4月から火曜定休になったので、
-- 混ぜたまま前年と比べると2026年が構造的に低く出る。

-- ─────────────────────────────────────────────────────────────
-- A. 曜日別の日商とばらつき（CV = 標準偏差 ÷ 平均）
--
-- CV がいくつかで「3か月で何が言えるか」が決まる。
-- 実測は 金0.35 土0.36 が最小、日0.85 が最大。
-- CV 0.35〜0.40 だと、20%の効果を売上で検出するのに片群49〜63日かかる。
-- ＝ 曜日を絞った施策の効果を日商で測るのは1年仕事。施策そのものの数で測ること。
-- ─────────────────────────────────────────────────────────────
select dow_ja,
       count(*)                                            as n,
       round(avg(dine_in_yen))                             as mean_yen,
       percentile_cont(0.5) within group (order by dine_in_yen) as median_yen,
       round(stddev_samp(dine_in_yen))                     as sd_yen,
       round(stddev_samp(dine_in_yen) / avg(dine_in_yen), 3) as cv
from v_sales_day
where dine_in_yen is not null
group by dow_ja, dow
order by dow;

-- ─────────────────────────────────────────────────────────────
-- B. 前年比を「同じ曜日どうしの中央値」で見る（火曜を除く）
--
-- 平均だと宴会1本で動くので中央値。1〜7月で見た実測（2026 vs 2025）:
--   日 68.9% / 水 70.9% / 月 81.9% / 木 83.7% / 金 93.1% / 土 99.2%  全体 86.5%
-- ＝ 落ちているのは日・水・月・木。金土はほぼ守れている。
-- ─────────────────────────────────────────────────────────────
with m as (
  select dow, dow_ja, yy,
         percentile_cont(0.5) within group (order by dine_in_yen) as med,
         count(*) as n
  from v_sales_day
  where dine_in_yen is not null
    and not is_tuesday
    and mm <= 7
  group by dow, dow_ja, yy
)
select a.dow_ja,
       a.n as n_2025, a.med as med_2025,
       b.n as n_2026, b.med as med_2026,
       round(b.med / a.med * 100, 1) as pct,
       -- 7か月ぶんでいくら違うか
       round((b.med - a.med) * b.n)  as diff_yen
from m a
join m b on b.dow = a.dow and b.yy = 2026
where a.yy = 2025
order by pct;

-- ─────────────────────────────────────────────────────────────
-- C. 「5万円に届かない日」が増えていないか
--
-- 上振れが減ったのか、下振れが増えたのかで打ち手が変わる。
-- 実測: 水曜は29日中15日が5万円未満（前年は9日）、日曜は8日→10日。
-- ＝ 山を高くする話ではなく、谷の日を埋める話。
-- ─────────────────────────────────────────────────────────────
select dow_ja, yy,
       count(*)                                            as n,
       count(*) filter (where dine_in_yen <  50000)        as under_50k,
       count(*) filter (where dine_in_yen between 50000 and 79999) as y50_80k,
       count(*) filter (where dine_in_yen between 80000 and 119999) as y80_120k,
       count(*) filter (where dine_in_yen >= 120000)       as over_120k
from v_sales_day
where dine_in_yen is not null and not is_tuesday and mm <= 7 and yy in (2025, 2026)
group by dow_ja, dow, yy
order by dow, yy;

-- ─────────────────────────────────────────────────────────────
-- D. 新居浜太鼓祭り（10/16-18）は開けているのか
--
-- 実測: 2024年は3日とも売上の行が無い（休業）。
--       2025年は10/16と10/18が行なし、10/17が10,000円。
-- 金曜の中央値が14万円台なので、この3日で毎年30万円前後の機会が消えている。
-- ＝ 店を開けずに折詰・弁当だけ売る、という手はまだ試していない。
-- ─────────────────────────────────────────────────────────────
select d::date                                     as biz_date,
       (array['日','月','火','水','木','金','土'])[extract(dow from d)::int + 1] as dow_ja,
       s.actual_yen,
       case when s.biz_date is null then '記録なし（休業とみられる）' end as note
from generate_series('2024-10-14'::date, '2024-10-20'::date, '1 day') d
left join sales_daily s on s.biz_date = d::date
union all
select d::date,
       (array['日','月','火','水','木','金','土'])[extract(dow from d)::int + 1],
       s.actual_yen,
       case when s.biz_date is null then '記録なし（休業とみられる）' end
from generate_series('2025-10-14'::date, '2025-10-20'::date, '1 day') d
left join sales_daily s on s.biz_date = d::date
order by 1;

-- ─────────────────────────────────────────────────────────────
-- E. 月ごとの前年比（火曜を除く中央値）
--
-- 実測: 1月75.5% 2月73.4% 3月92.1% 4月82.9% 5月71.7% 6月85.0% → 7月112.9%
-- ＝ 落ち込みは1〜6月の話で、7月に向きが変わっている。
--    8月・9月の数字が出れば、反転が本物かどうか分かる。
-- ─────────────────────────────────────────────────────────────
with m as (
  select mm, yy,
         percentile_cont(0.5) within group (order by dine_in_yen) as med,
         count(*) as n
  from v_sales_day
  where dine_in_yen is not null and not is_tuesday
  group by mm, yy
)
select a.mm,
       a.n as n_2025, a.med as med_2025,
       b.n as n_2026, b.med as med_2026,
       round(b.med / a.med * 100, 1) as pct
from m a
join m b on b.mm = a.mm and b.yy = 2026
where a.yy = 2025
order by a.mm;

-- ─────────────────────────────────────────────────────────────
-- F. 物販が乗った日の、店内へのはね返り（カニバリ差分）
--
-- 物販の成否を売上で測ってはいけない。見るのは
-- 「その日の店内が、同じ曜日の中央値からいくら下がったか」。
-- 7/26（うなぎ太巻き）は店内 約57,830円 で、日曜の中央値を約26,000円下回っていた。
--
-- tax8_yen が入っていない日は物販ゼロ扱いなので、何も出ない。
-- 週次レポートから税率別が届くようになれば、ここが自動で埋まる。
-- ─────────────────────────────────────────────────────────────
with base as (
  select dow, percentile_cont(0.5) within group (order by dine_in_yen) as med
  from v_sales_day
  where dine_in_yen is not null and not has_retail
  group by dow
)
select v.biz_date, v.dow_ja,
       v.actual_yen                as 総額,
       v.retail_yen                as 物販,
       v.dine_in_yen               as 店内,
       b.med                       as その曜日の中央値,
       v.dine_in_yen - b.med       as カニバリ差分
from v_sales_day v
join base b on b.dow = v.dow
where v.has_retail
order by v.biz_date desc;
