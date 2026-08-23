-- 02 894日の日次売上から、今日読み取れること
--
-- 前提：v_sales_day（01）と jp_holidays（00）を先に流しておく。
-- どのクエリも「火曜を除く」で書いてある。2026-03-31 を最後に火曜定休になったので、
-- 火曜を混ぜると 2026 年だけ日数が減って、前年比が実力以上に悪く見える。

\echo '=== A. 曜日の型（直近52週・火曜除く） ============================'
-- 平均ではなく中央値と四分位で見る。1日の売上は外れ値がすぐ効くので、平均は当てにならない。
select dow_ja as 曜日, count(*) as 日数,
  percentile_cont(0.25) within group (order by actual_yen)::int as "下位25%",
  percentile_cont(0.50) within group (order by actual_yen)::int as 中央値,
  percentile_cont(0.75) within group (order by actual_yen)::int as "上位25%",
  avg(actual_yen)::int as 平均
from v_sales_day
where actual_yen is not null and not is_tuesday
  and biz_date >= (now() at time zone 'Asia/Tokyo')::date - 364
group by dow_ja, dow order by dow;

\echo '=== B. 平日と金土、落ちているのはどちらか（半期ごとの中央値） ====='
-- ここが今回いちばん効く1枚。金土だけ見ていると「横ばい」に見えるが、
-- 平日が落ちている場合、月の合計だけが静かに減っていく。
select
  case when biz_date < '2024-07-01' then '2024年前半'
       when biz_date < '2025-01-01' then '2024年後半'
       when biz_date < '2025-07-01' then '2025年前半'
       when biz_date < '2026-01-01' then '2025年後半'
       else '2026年前半' end as 期間,
  percentile_cont(0.5) within group (order by actual_yen) filter (where not is_fri_sat)::int as 平日中央値,
  count(*) filter (where not is_fri_sat) as 平日数,
  percentile_cont(0.5) within group (order by actual_yen) filter (where is_fri_sat)::int as 金土中央値,
  count(*) filter (where is_fri_sat) as 金土数
from v_sales_day
where actual_yen is not null and not is_tuesday and biz_date < '2026-07-01'
group by 1 order by 1;

\echo '=== C. 曜日ごとに何%落ちたか（年別中央値） ======================='
select dow_ja as 曜日,
  percentile_cont(0.5) within group (order by actual_yen) filter (where yy=2024)::int as "2024",
  percentile_cont(0.5) within group (order by actual_yen) filter (where yy=2025)::int as "2025",
  percentile_cont(0.5) within group (order by actual_yen) filter (where yy=2026)::int as "2026(1-6月)",
  round((100.0 * percentile_cont(0.5) within group (order by actual_yen) filter (where yy=2026)
       / nullif(percentile_cont(0.5) within group (order by actual_yen) filter (where yy=2025),0) - 100)::numeric,1) as "26vs25%"
from v_sales_day
where actual_yen is not null and not is_tuesday and biz_date < '2026-07-01'
group by dow_ja, dow order by dow;

\echo '=== D. 前年同月比（火曜を抜いた「1営業日あたり」で揃える） ======='
-- 月合計を並べると、営業日数と火曜定休の差でズレる。1営業日あたりに直して初めて比較になる。
with m as (
  select yy, mm, count(*) d, avg(actual_yen)::int per_day, sum(actual_yen)::bigint tot
  from v_sales_day where actual_yen is not null and not is_tuesday group by yy, mm)
select mm as 月,
  max(per_day) filter (where yy=2024) as "2024_1日あたり",
  max(per_day) filter (where yy=2025) as "2025_1日あたり",
  max(per_day) filter (where yy=2026) as "2026_1日あたり",
  round((100.0*max(per_day) filter (where yy=2025)/nullif(max(per_day) filter (where yy=2024),0)-100)::numeric,1) as "25vs24%",
  round((100.0*max(per_day) filter (where yy=2026)/nullif(max(per_day) filter (where yy=2025),0)-100)::numeric,1) as "26vs25%"
from m group by mm order by mm;

\echo '=== E. 「繁忙日＝金土」ルールの当たり外れ（直近52週） ============'
-- 繁忙日フラグは飾りではない：net_reserve() が「繁忙日の3名以下はカウンターのみ」を効かせる。
-- 外すとテーブルが少人数で埋まる。当てすぎても金土に無駄な人を置く。
with b as (
  select actual_yen, is_fri_sat from v_sales_day
  where actual_yen is not null and not is_tuesday
    and biz_date >= (now() at time zone 'Asia/Tokyo')::date - 364)
select t.thr as 閾値,
  count(*) filter (where actual_yen >= t.thr) as 実際に忙しかった日,
  count(*) filter (where actual_yen >= t.thr and is_fri_sat) as 金土で当てた,
  count(*) filter (where actual_yen >= t.thr and not is_fri_sat) as 平日なのに忙しかった_見逃し,
  count(*) filter (where actual_yen <  t.thr and is_fri_sat) as 金土なのに暇だった_空振り,
  round((100.0*count(*) filter (where actual_yen >= t.thr and is_fri_sat)
       / nullif(count(*) filter (where is_fri_sat),0))::numeric,0) as "金土のうち当たった%"
from b cross join unnest(array[100000,120000,150000]) as t(thr)
group by t.thr order by t.thr;

\echo '=== F. 祝日は「当日」ではなく「前日」に効く（日〜木のみ） ========'
-- 金曜は常に翌日が土曜なので、比較から外さないと祝日の効果が見えない。
select
  case when is_holiday_eve then '祝日の前日'
       when is_holiday     then '祝日そのもの'
       else '通常' end as 区分,
  count(*) as 日数,
  percentile_cont(0.5) within group (order by actual_yen)::int as 中央値,
  avg(actual_yen)::int as 平均
from v_sales_day
where actual_yen is not null and dow in (0,1,3,4)
group by 1 order by 3 desc;

\echo '=== G. 12月・お盆・太鼓祭りの効き方（火曜除く） =================='
select
  case when is_taiko_matsuri then '太鼓祭り(10/16-18)'
       when is_bounenkai     then '忘年会(12/10-31)'
       when is_obon          then 'お盆(8/11-16)'
       when mm = 10          then '10月のその他の日'
       else 'それ以外' end as 区分,
  count(*) as 日数,
  percentile_cont(0.5) within group (order by actual_yen) filter (where not is_fri_sat)::int as 平日中央値,
  percentile_cont(0.5) within group (order by actual_yen) filter (where is_fri_sat)::int as 金土中央値,
  count(*) filter (where actual_yen >= 120000) as "12万超の日数"
from v_sales_day where actual_yen is not null and not is_tuesday
group by 1 order by 3 desc nulls last;

\echo '=== G2. 新居浜太鼓祭り（10/16-18）の3日間に、実際は何があったか ==='
-- G の箱では「売上の行がある日」しか数えられない。休んだ日は行ごと無いので消えてしまう。
-- カレンダー側から引き直して「開けたのか・いくらだったのか」を出す。
select c.d::date as 日付,
  (array['日','月','火','水','木','金','土'])[extract(dow from c.d)::int + 1] as 曜日,
  case when s.biz_date is null then '（記録なし＝休業とみられる）'
       else to_char(s.actual_yen, 'FM999,999,999') || '円' end as 売上,
  s.target_yen as 目標
from generate_series(date '2024-10-16', date '2026-10-18', interval '1 day') c(d)
left join sales_daily s on s.biz_date = c.d
where to_char(c.d,'MM-DD') between '10-16' and '10-18'
order by c.d;

\echo '=== H. 目標と実績が噛み合っているか（月別） ======================'
select ym as 月, count(*) as 日数,
  count(*) filter (where actual_yen >= target_yen) as 達成日数,
  percentile_cont(0.5) within group (order by 100.0*actual_yen/target_yen)::int as "達成率の中央値%",
  avg(abs(actual_yen - target_yen))::int as "1日あたりのズレ幅"
from v_sales_day
where actual_yen is not null and target_yen > 0 and biz_date >= '2026-01-01'
group by ym order by ym;

\echo '=== I. 目標のズレは曜日に偏っているか（2026-06以降） ============='
select dow_ja as 曜日, count(*) as 日数,
  count(*) filter (where actual_yen >= target_yen) as 達成,
  percentile_cont(0.5) within group (order by 100.0*actual_yen/target_yen)::int as "達成率の中央値%"
from v_sales_day
where actual_yen is not null and target_yen > 0 and biz_date >= '2026-06-01'
group by dow_ja, dow order by dow;

\echo '=== J. 目標の置き直し案（月間合計はそのまま・曜日の重みだけ実績に） ='
-- :ym と :monthly_target を差し替えて使う。例では 2026-09 / 2,780,000円。
with idx as (
  select dow, percentile_cont(0.5) within group (order by actual_yen) w
  from v_sales_day
  where actual_yen is not null and not is_tuesday
    and biz_date >= (now() at time zone 'Asia/Tokyo')::date - 364
  group by dow),
days as (
  select d::date biz_date, extract(dow from d)::int dow
  from generate_series(date '2026-09-01', date '2026-09-30', interval '1 day') d
  where extract(dow from d)::int <> 2),
w as (select days.biz_date, days.dow, idx.w from days join idx using (dow)),
prop as (
  select w.biz_date, w.dow, round(2780000 * w.w / sum(w.w) over ())::int as newt from w)
select (array['日','月','火','水','木','金','土'])[p.dow+1] as 曜日,
  count(*) as 日数,
  max(s.target_yen) as 今の目標,
  max(p.newt)       as 実績準拠の目標,
  max(p.newt) - max(s.target_yen) as 差,
  sum(s.target_yen) as 今の合計,
  sum(p.newt)       as 案の合計
from prop p join sales_daily s on s.biz_date = p.biz_date
group by p.dow order by p.dow;

\echo '=== K. 外れ値（曜日ごとのMADで見た飛び値・直近52週） ============'
-- 標準偏差だと外れ値自身が σ を膨らませて検出漏れする。中央絶対偏差(MAD)を使う。
-- |z| >= 3.5 だけを出す。ここに出た日は「何があったか」を必ず書き残す価値がある。
with b as (
  select biz_date, dow, dow_ja, actual_yen from v_sales_day
  where actual_yen is not null
    and biz_date >= (now() at time zone 'Asia/Tokyo')::date - 364),
st as (select dow, percentile_cont(0.5) within group (order by actual_yen) med from b group by dow),
mad as (select b.dow, percentile_cont(0.5) within group (order by abs(b.actual_yen - s.med)) m
        from b join st s using (dow) group by b.dow)
select b.biz_date, b.dow_ja as 曜日, b.actual_yen as 売上, st.med::int as 曜日中央値,
  round((0.6745*(b.actual_yen - st.med)/nullif(mad.m,0))::numeric,1) as ロバストZ
from b join st using (dow) join mad using (dow)
where abs(0.6745*(b.actual_yen - st.med)/nullif(mad.m,0)) >= 3.5
order by abs(0.6745*(b.actual_yen - st.med)/nullif(mad.m,0)) desc;

\echo '=== L. 月末の着地見込み（今月・曜日中央値で残りを埋める） ========'
-- スマホで見る数字はこの1行でいい。「このままなら月末は◯円」。
with cur as (select date_trunc('month', (now() at time zone 'Asia/Tokyo')::date)::date as m0),
idx as (
  select dow, percentile_cont(0.5) within group (order by actual_yen) ev
  from v_sales_day, cur
  where actual_yen is not null and not is_tuesday
    and biz_date <  cur.m0 and biz_date >= cur.m0 - 364
  group by dow),
days as (
  -- 火曜と、営業日設定で休みにした日は数えない
  select d::date biz_date, extract(dow from d)::int dow
  from cur, generate_series(cur.m0, (cur.m0 + interval '1 month - 1 day')::date, interval '1 day') d
  where extract(dow from d)::int <> 2
    and not coalesce((select b.is_closed from business_days b where b.biz_date = d::date), false)),
j as (
  select days.biz_date, coalesce(s.actual_yen, idx.ev) as yen, (s.actual_yen is not null) as done
  from days join idx using (dow) left join sales_daily s on s.biz_date = days.biz_date and s.actual_yen is not null)
select to_char((select m0 from cur),'YYYY-MM') as 月,
  count(*) filter (where done) as 済んだ日数,
  sum(yen) filter (where done)::bigint as 今までの実績,
  sum(yen)::bigint as 月末の着地見込み,
  (select target_yen from sales_monthly where ym = to_char((select m0 from cur),'YYYY-MM')) as 月間目標,
  sum(yen)::bigint - coalesce((select target_yen from sales_monthly where ym = to_char((select m0 from cur),'YYYY-MM')),0) as 過不足
from j;

\echo '=== M. データ品質1：実績が入っていない日（休業か取り込み漏れか） =='
-- sales_daily には「休業」を表す列が無い。行が無い日が休業なのか未取り込みなのか区別できない。
-- 連続した3日以上は休業、単発は取り込み漏れの疑い、という読み方をする。
-- 実績はエアレジから週次で入るので、直近7日はまだ入っていなくて当たり前。そこは見ない。
with cal as (select d::date d from generate_series(date '2024-01-04', (now() at time zone 'Asia/Tokyo')::date - 7, interval '1 day') d),
miss as (
  select c.d, (extract(dow from c.d)::int = 2 and c.d >= '2026-04-01') as tuesday_closed
  from cal c left join sales_daily s on s.biz_date = c.d and s.actual_yen is not null
  where s.biz_date is null),
grp as (select d, tuesday_closed, d - (row_number() over (order by d))::int * interval '1 day' as g from miss where not tuesday_closed)
select min(d) as 開始, max(d) as 終了, count(*) as 連続日数,
  case when count(*) >= 3 then '休業とみられる' else '要確認（取り込み漏れ？）' end as 見立て
from grp group by g order by min(d);

\echo '=== N. データ品質2：日次目標の合計と月間目標が合っているか ======='
-- 画面の達成率は sales_monthly を、日ごとの棒は sales_daily を見ている。
-- ここがズレていると「棒は全部未達なのに達成率は100%超」という表示になる。
select coalesce(d.ym, m.ym) as 月, d.日次目標の合計, m.target_yen as 月間目標,
  d.日次目標の合計 - m.target_yen as 差
from (select to_char(biz_date,'YYYY-MM') ym, sum(target_yen) 日次目標の合計
      from sales_daily where target_yen is not null group by 1) d
full join sales_monthly m on m.ym = d.ym
where d.ym >= '2026-01'
order by 1;
