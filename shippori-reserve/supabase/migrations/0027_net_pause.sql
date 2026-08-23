-- 0027 ネット予約の一時停止（とても忙しい日に、現場から当日分だけ止める）
--
-- 席ボードの「新規予約停止」を押すと、その営業日のネット予約だけが止まる。
-- 翌日以降の予約はいつもどおり受け付ける（機会損失を最小にするため）。
--
-- 止めた時刻と再開した時刻は必ず1行として残す。これは記録のためであると同時に、
-- 「止めっぱなしにすると月の合計時間として見える」という抑止のためでもある。

create table if not exists net_pause (
  id         uuid primary key default gen_random_uuid(),
  biz_date   date not null,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  started_by uuid references profiles(id),
  ended_by   uuid references profiles(id)
);

-- 同じ営業日に「開いたままの停止」は1つだけ
create unique index if not exists net_pause_one_open
  on net_pause (biz_date) where ended_at is null;

create index if not exists net_pause_biz_date on net_pause (biz_date);

alter table net_pause enable row level security;

do $$ begin
  create policy net_pause_read on net_pause for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- 書き込みはこの関数だけ。現場の誰でも押せる（忙しい最中に権限で迷わせない）
create or replace function public.set_net_pause(p_date date, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;

  if p_on then
    -- 既に止まっているなら二重に記録しない
    insert into net_pause (biz_date, started_by)
    select p_date, auth.uid()
     where not exists (
       select 1 from net_pause where biz_date = p_date and ended_at is null
     );
  else
    update net_pause
       set ended_at = now(), ended_by = auth.uid()
     where biz_date = p_date and ended_at is null;
  end if;
end;
$$;

grant execute on function public.set_net_pause(date, boolean) to authenticated;

-- 最後の砦にも停止を見せる：止めている間はその日の登録を通さない
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

  select * into v_day from business_days where biz_date = p_date;
  v_found := found;

  if v_found and v_day.is_closed then
    raise exception 'NET_CLOSED';
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
      -- 席ボード（飛び込み）は予約と重なっている可能性があるので大きい方を採る。
      -- 旧'C'（合計値）と 'C1'〜'C10'（1席ずつ）の両方式に対応
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
