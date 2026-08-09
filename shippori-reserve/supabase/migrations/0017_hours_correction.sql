-- 0017 営業時間の訂正（店主フィードバック 2026-08-08 その11）
--
-- 「18:00〜24:00」はイベント営業のときだけ、だった。
-- 通常営業は従来どおり平日24:00・金土25:00閉店に戻す。
-- （0016 のうちイベント既定定員36はそのまま）

update settings set value = '{"weekday":1440,"friday_saturday":1500}'::jsonb
 where key = 'default_close_min';

-- 行が無い日を曜日から実体化する関数も金土25:00に戻す
create or replace function public.ensure_business_day(d date)
returns business_days language plpgsql security definer set search_path = public as $$
declare
  dow    int := extract(dow from d);          -- 0=日 … 6=土
  closed boolean;
  cmin   int;
  row    business_days;
begin
  closed := coalesce(
    (select value @> to_jsonb(dow) from settings where key = 'closed_weekdays'), false);
  cmin := case when dow in (5, 6) then 1500 else 1440 end;   -- 金土は25:00まで

  insert into business_days (biz_date, mode, is_closed, open_min, close_min)
  values (d, 'normal', closed, 1080, cmin)
  on conflict (biz_date) do nothing;

  select * into row from business_days where biz_date = d;
  return row;
end;
$$;

-- 0016 で 24:00 に寄せてしまった金土の通常営業の行を 25:00 に戻す。
-- まだ運用開始前なので一括でよい（イベント営業の行は触らない）。
update business_days set close_min = 1500
 where mode = 'normal' and close_min = 1440
   and extract(dow from biz_date) in (5, 6);
