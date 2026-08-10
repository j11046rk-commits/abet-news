-- 0030 売上を税率で分ける（店内飲食と物販の切り分け）
--
-- うなぎの太巻きのような物販が1日で62万入ると、その日の売上が通常営業の5日分になり、
-- 平均・前年比・目標の達成判定がすべて歪む。かといって手で分類するのは続かない。
--
-- 日本の消費税は、店内で食べれば10%、持ち帰れば8%（軽減税率）。
-- つまりエアレジが税率別に出している金額が、そのまま「店内飲食」と「物販」の境目になる。
--   10% … 店内飲食（お酒を含む）
--    8% … 持ち帰りの食品（太巻き・オードブルなど）
--
-- 完全ではない（持ち帰りのお酒は10%、店内で食べた太巻きも10%）が、
-- この店の商売では実用上まっすぐ切れる。
--
-- 解釈ではなく「税率いくらの売上がいくらか」という事実のまま持つ。
-- 店内／物販への読み替えはアプリ側で行う——将来ルールが変わっても、記録は壊れない。

alter table sales_daily add column if not exists tax10_yen integer
  check (tax10_yen is null or (tax10_yen >= 0 and tax10_yen <= 100000000));
alter table sales_daily add column if not exists tax8_yen integer
  check (tax8_yen is null or (tax8_yen >= 0 and tax8_yen <= 100000000));

comment on column sales_daily.tax10_yen is
  '消費税10%対象の売上（＝店内飲食）。エアレジの税率別集計から取り込む。未取得の日は null';
comment on column sales_daily.tax8_yen is
  '消費税8%対象の売上（＝持ち帰り＝物販）。エアレジの税率別集計から取り込む。未取得の日は null';

-- 手入力（営業日の設定画面）からは税率別を触らない。既存の関数はそのままでよいが、
-- 引数を増やさずに済むよう、ここでは何も変えない。

-- 分析用ビューがあれば、店内／物販を出せるように作り直す
-- （supabase/analysis/01_v_sales_day.sql と同じ定義に2列足したもの。無ければ何もしない）
do $$
begin
  if exists (select 1 from information_schema.views
              where table_schema = 'public' and table_name = 'v_sales_day') then
    -- 列を途中に足すので、置き換えではなく作り直す
    execute 'drop view v_sales_day';
    execute $v$
      create view v_sales_day with (security_invoker = true) as
      select
        s.biz_date,
        extract(dow from s.biz_date)::int as dow,
        (array['日','月','火','水','木','金','土'])[extract(dow from s.biz_date)::int + 1] as dow_ja,
        to_char(s.biz_date, 'YYYY-MM') as ym,
        extract(year  from s.biz_date)::int as yy,
        extract(month from s.biz_date)::int as mm,
        extract(day   from s.biz_date)::int as dd,
        s.target_yen,
        s.actual_yen,
        s.tax10_yen,
        s.tax8_yen,
        -- 店内飲食だけの売上。税率別が無い日は、物販が無かったものとして actual をそのまま使う
        coalesce(s.tax10_yen, s.actual_yen) as dine_in_yen,
        coalesce(s.tax8_yen, 0)             as retail_yen,
        (s.tax8_yen is not null and s.tax8_yen > 0) as has_retail,
        (extract(dow from s.biz_date)::int = 2) as is_tuesday,
        (extract(dow from s.biz_date)::int in (5,6)) as is_fri_sat,
        h.name as holiday_name,
        (h.name is not null) as is_holiday,
        hn.name as next_holiday_name,
        (hn.name is not null) as is_holiday_eve,
        (extract(dow from s.biz_date + 1)::int in (0,6) or hn.name is not null) as tomorrow_off,
        (to_char(s.biz_date,'MM-DD') between '08-11' and '08-16') as is_obon,
        (extract(month from s.biz_date)::int = 12
           and extract(day from s.biz_date)::int >= 10) as is_bounenkai,
        (to_char(s.biz_date,'MM-DD') between '10-16' and '10-18') as is_taiko_matsuri,
        b.mode, b.is_busy, b.is_closed, b.event_name, b.open_min, b.close_min
      from sales_daily s
      left join jp_holidays h  on h.d = s.biz_date
      left join jp_holidays hn on hn.d = s.biz_date + 1
      left join business_days b on b.biz_date = s.biz_date
    $v$;
    execute 'grant select on v_sales_day to authenticated';
    execute 'revoke all on v_sales_day from anon';
  end if;
end $$;
