-- 0003 営業日（通常営業 / イベント営業の切り替え）
-- docs/03-database.md §3-5 に対応。

create table if not exists business_days (
  biz_date       date primary key,
  mode           business_mode not null default 'normal',
  is_busy        boolean not null default false,
  is_closed      boolean not null default false,
  event_name     text,
  event_capacity integer check (event_capacity is null or event_capacity > 0),
  open_min       integer not null default 1080 check (open_min between 0 and 1440),
  -- default を置いてあるのは、手で1行入れたときに 24:00 閉店として通るようにするため。
  -- 通常は ensure_business_day() が曜日から入れる（金土は 1500）。
  close_min      integer not null default 1440 check (close_min > open_min and close_min <= 2160),
  note           text,
  updated_by     uuid references profiles(id),
  updated_at     timestamptz not null default now(),
  -- イベント営業なら定員が必須（席管理ではなく定員管理に切り替わるため）
  constraint business_days_event_needs_capacity
    check (mode <> 'event' or event_capacity is not null)
);

create index if not exists business_days_mode_idx on business_days (mode) where mode = 'event';
create index if not exists business_days_busy_idx on business_days (biz_date) where is_busy;

-- 行が無い日は曜日から導出する。予約が入る／設定を触るタイミングで実体化する。
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

grant execute on function public.ensure_business_day(date) to authenticated;

create or replace function public.touch_business_day()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists business_days_touch on business_days;
create trigger business_days_touch
  before update on business_days for each row execute function touch_business_day();
