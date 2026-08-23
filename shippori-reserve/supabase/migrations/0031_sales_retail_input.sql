-- 0031 物販（税率8%）を手でも入れられるようにする
--
-- 0030 でエアレジの税率別を受け取る口は作ったが、週次レポート側が税率別を送れるように
-- なるまでは箱が空のままになる。太巻きの日のような「その日だけ物販が乗った日」は
-- 店主が数字を知っているので、営業日の設定から直接入れられるようにする。
--
-- 入れるのは「うち物販（8%）」の1つだけ。店内飲食は 実績 − 物販 で出す。
-- 2つ入力させると必ず合計が合わなくなる日が出るので、入り口は1つに絞る。

-- 1) ビューの店内飲食を、税率別が片方しか無くても正しく出せるようにする。
--    旧: coalesce(tax10, actual)            … tax8 だけ入れた日に物販が二重に乗る
--    新: coalesce(tax10, actual - tax8)     … どちらの入り方でも合う
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
        -- 店内飲食だけの売上。
        -- エアレジから10%が来ていればそれを使い、無ければ「実績 − 物販」で出す。
        coalesce(s.tax10_yen, s.actual_yen - coalesce(s.tax8_yen, 0)) as dine_in_yen,
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

-- 2) 手入力の「うち物販」は、既存の set_sales_day には足さず別の関数にする。
--    引数を増やすと、アプリを先に出した瞬間に目標・実績の保存まで巻き添えで壊れる。
--    別関数なら、物販欄だけが後から効くようになるだけで済む。
create or replace function public.set_sales_retail(p_date date, p_retail integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actual integer;
begin
  if not has_permission('sales.write') then
    raise exception '権限がありません。';
  end if;
  if p_retail is null then
    return;                          -- null は「触らない」
  end if;
  if p_retail < 0 then
    raise exception '金額が不正です。';
  end if;

  select actual_yen into v_actual from sales_daily where biz_date = p_date;

  -- 物販が実績を超えるのは、どちらかの打ち間違い。入る前に止める。
  if p_retail > 0 then
    if v_actual is null then
      raise exception '先にその日の実績を入れてください。';
    end if;
    if p_retail > v_actual then
      raise exception '物販が実績を超えています。';
    end if;
  end if;

  insert into sales_daily (biz_date, tax8_yen, updated_by)
  values (p_date, p_retail, auth.uid())
  on conflict (biz_date) do update
    set tax8_yen   = p_retail,       -- 0 を入れれば「物販なし」に戻せる
        updated_by = auth.uid(),
        updated_at = now();
end;
$$;

revoke execute on function public.set_sales_retail(date, integer) from public, anon;
grant  execute on function public.set_sales_retail(date, integer) to authenticated;
