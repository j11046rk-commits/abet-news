-- 0028 イベント営業のチラシと、当日ネット予約の締切
--
-- イベント営業は通常営業とメニューも価格も違う。お客様が知らずに予約して
-- 「思っていたのと違う」となるのを防ぐため、
--   ・イベント日はチラシ（画像/PDF）の登録を必須にする
--   ・予約ページでチラシを見せ、了承のチェックを取る
--   ・準備の都合もあるので、ネット予約は前日までで締め切る
-- という3点を仕組みとして持たせる。

alter table business_days add column if not exists flyer_url text;

comment on column business_days.flyer_url is
  'イベント営業のチラシ（画像またはPDF）の公開URL。イベント日は必須。';

-- チラシの置き場所。公開バケット（予約ページのお客様が見るため）
insert into storage.buckets (id, name, public)
values ('flyers', 'flyers', true)
on conflict (id) do update set public = true;

do $$ begin
  create policy flyers_public_read on storage.objects
    for select using (bucket_id = 'flyers');
exception when duplicate_object then null; end $$;

-- 最後の砦：イベント日の当日ネット予約は通さない（前日まで）
create or replace function public.net_reserve(
  p_date      date,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_party     integer,
  p_name      text,
  p_kana      text,
  p_phone     text,
  p_memo      text,
  p_seat_note text
) returns table (id uuid, reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day    business_days%rowtype;
  v_found  boolean;
  v_busy   boolean;
  v_cap    integer;
  v_guests integer;
  v_unit   seat_units%rowtype;
  v_used   integer;
  v_today  date;
begin
  if p_party is null or p_party < 1 or p_party > 8 then
    raise exception 'NET_PARTY';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'NET_NAME';
  end if;

  perform pg_advisory_xact_lock(hashtext('net-reserve-' || p_date::text));

  -- 現場が受付を止めている日
  if exists (select 1 from net_pause where biz_date = p_date and ended_at is null) then
    raise exception 'NET_PAUSED';
  end if;

  -- 営業日は朝4時で切り替わる（深夜1時はまだ前日の営業）
  v_today := ((now() at time zone 'Asia/Tokyo') - interval '4 hours')::date;

  select * into v_day from business_days where biz_date = p_date;
  v_found := found;

  if v_found and v_day.is_closed then
    raise exception 'NET_CLOSED';
  end if;

  -- イベント営業のネット予約は前日まで
  if v_found and v_day.mode = 'event' and p_date <= v_today then
    raise exception 'NET_EVENT_TODAY';
  end if;

  v_busy := case when v_found then v_day.is_busy
                 else extract(dow from p_date) in (5, 6) end;

  if v_found and v_day.mode = 'event' then
    v_cap := coalesce(v_day.event_capacity, 36);
    select coalesce(sum(party_size), 0) into v_guests
      from reservations
     where biz_date = p_date and status in ('tentative', 'confirmed', 'seated');
    if v_guests + p_party > v_cap then
      raise exception 'NET_FULL';
    end if;
  elsif p_seat_note is not null and p_seat_note <> '指定なし' then
    select * into v_unit from seat_units where name = p_seat_note and is_active;
    if not found then
      raise exception 'NET_SEAT_UNKNOWN';
    end if;
    if v_busy and p_party <= 3 and not v_unit.is_shared then
      raise exception 'NET_BUSY_RULE';
    end if;
    if v_unit.is_shared then
      select coalesce(sum(party_size), 0) into v_used
        from reservations
       where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
         and seat_note is not null
         and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'));
      v_used := greatest(
        v_used,
        coalesce((select occupied from seat_board where biz_date = p_date and key = 'C'), 0),
        coalesce((select sum(occupied) from seat_board
                   where biz_date = p_date and key ~ '^C[0-9]+$'), 0));
      if v_used + p_party > v_unit.capacity then
        raise exception 'NET_FULL';
      end if;
    else
      if exists (
        select 1 from reservations
         where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
           and seat_note is not null
           and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'))
      ) or exists (
        select 1 from seat_board
         where biz_date = p_date and key = p_seat_note and occupied > 0
      ) then
        raise exception 'NET_FULL';
      end if;
    end if;
  end if;

  return query
  insert into reservations
    (biz_date, starts_at, ends_at, party_size, customer_name, customer_kana, phone,
     source, source_detail, status, seat_note, memo)
  values
    (p_date, p_starts_at, p_ends_at, p_party, btrim(p_name), nullif(btrim(coalesce(p_kana, '')), ''),
     p_phone, 'web_form', 'ネット予約', 'confirmed', p_seat_note,
     nullif(btrim(coalesce(p_memo, '')), ''))
  returning reservations.id, reservations.reference;
end;
$$;
