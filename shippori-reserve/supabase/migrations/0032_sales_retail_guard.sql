-- 0032 物販を入れたあとの「実績の後出し訂正」を止める
--
-- 0031 の set_sales_retail は、物販を書くときに「物販 ≦ 実績」を確かめる。
-- ところが逆向きが素通りしていた——先に物販を入れておいて、あとから実績だけを
-- 小さい額に直せる。そうなると 店内＝実績−物販 が負になり、
-- カレンダーにも売上タブにもマイナスの金額が出る。
--
-- 訂正は実際に起きる（7/26のカニバリの数字を一度直している）。
-- 入る前に止める。

-- 目標・実績・物販を1回でまとめて書く。
--
-- 0031 では set_sales_day と set_sales_retail の2本に分けたが、それだと
-- 「実績も物販も両方下げる」訂正が通らない。片方ずつ書くので、実績を先に下げると
-- まだ古いままの物販を下回って弾かれ、物販を先に下げると実績を超えて弾かれる。
-- 訂正は実際に起きるので（7/26の数字を一度直している）、3つ揃えて1回で見る。
create or replace function public.set_sales_day_all(
  p_date   date,
  p_target integer,
  p_actual integer,
  p_retail integer
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actual integer;
  v_retail integer;
begin
  if not has_permission('sales.write') then
    raise exception '権限がありません。';
  end if;
  if (p_target is not null and p_target < 0)
     or (p_actual is not null and p_actual < 0)
     or (p_retail is not null and p_retail < 0) then
    raise exception '金額が不正です。';
  end if;

  select actual_yen, tax8_yen into v_actual, v_retail
    from sales_daily where biz_date = p_date;

  -- null は「触らない」。書いたあとの姿で見る。
  v_actual := coalesce(p_actual, v_actual);
  v_retail := coalesce(p_retail, v_retail);

  if v_retail is not null and v_retail > 0 then
    if v_actual is null then
      raise exception '先にその日の実績を入れてください。';
    end if;
    if v_retail > v_actual then
      raise exception '物販が実績を超えています。';
    end if;
  end if;

  insert into sales_daily (biz_date, target_yen, actual_yen, tax8_yen, updated_by)
  values (p_date, p_target, p_actual, p_retail, auth.uid())
  on conflict (biz_date) do update
    set target_yen = coalesce(p_target, sales_daily.target_yen),
        actual_yen = coalesce(p_actual, sales_daily.actual_yen),
        tax8_yen   = coalesce(p_retail, sales_daily.tax8_yen),
        updated_by = auth.uid(),
        updated_at = now();
end;
$$;

revoke execute on function public.set_sales_day_all(date, integer, integer, integer) from public, anon;
grant  execute on function public.set_sales_day_all(date, integer, integer, integer) to authenticated;

-- 分析ビューの「店内」も、アプリと同じ式に揃える。
--   旧: coalesce(tax10, actual - tax8)   … 10%を優先
--   新: coalesce(actual - tax8, tax10)   … 実績を優先
--
-- 画面には「店内 ＋ 物販 ＝ 合計」が並ぶので、この足し算が必ず合う必要がある。
-- 10%を優先すると、商品券や0%対象がある日に合わなくなる。
-- 実績が無い日だけ、エアレジの10%を予備に使う。
do $$
begin
  if exists (select 1 from information_schema.views
              where table_schema = 'public' and table_name = 'v_sales_day') then
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
        coalesce(s.actual_yen - coalesce(s.tax8_yen, 0), s.tax10_yen) as dine_in_yen,
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
