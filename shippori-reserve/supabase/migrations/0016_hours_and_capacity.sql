-- 0016 営業時間とイベント定員の既定値変更（店主フィードバック 2026-08-08 その10）
--
-- 営業時間はどの曜日も 18:00〜24:00（金土だけ25:00まで、をやめる）。
-- イベント営業の既定定員は 60 → 36 名（店の席数と同じ）。
-- 個別の日で営業時間を変える機能はそのまま（既定値だけの変更）。

update settings set value = '{"weekday":1440,"friday_saturday":1440}'::jsonb
 where key = 'default_close_min';

update settings set value = '36'::jsonb
 where key = 'default_event_capacity';

-- 行が無い日を曜日から実体化する関数も 24:00 閉店に揃える
create or replace function public.ensure_business_day(d date)
returns business_days language plpgsql security definer set search_path = public as $$
declare
  dow    int := extract(dow from d);          -- 0=日 … 6=土
  closed boolean;
  row    business_days;
begin
  closed := coalesce(
    (select value @> to_jsonb(dow) from settings where key = 'closed_weekdays'), false);

  insert into business_days (biz_date, mode, is_closed, open_min, close_min)
  values (d, 'normal', closed, 1080, 1440)
  on conflict (biz_date) do nothing;

  select * into row from business_days where biz_date = d;
  return row;
end;
$$;

-- 旧既定（金土25:00）のまま実体化された行を 24:00 に揃える。
-- まだ運用開始前なので一括でよい。手動で25:00超に設定し直した日ができたら、その日は個別設定として残る。
update business_days set close_min = 1440 where close_min = 1500;
