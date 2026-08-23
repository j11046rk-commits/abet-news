-- 0025 席ボード（タブレット常設・飛び込みのリアルタイム管理）
--
-- 「実際は飛び込みで埋まっている席」を、レジ横のタブレットからワンタップで記録する。
-- ネット予約の空席判定は「予約データ ＋ 席ボード」の両方が空いているときだけ◯になる。
-- 行は営業日(biz_date)ごとに持つ＝日付が変われば自動的にまっさら（昨日の残り事故なし）。

create table if not exists seat_board (
  biz_date   date not null,
  -- 'T1' 'T2' 'T3' '和室' はその卓が使用中か(0/1)。'C' はカウンターの使用席数(0〜10)
  key        text not null,
  occupied   integer not null default 0 check (occupied between 0 and 10),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  primary key (biz_date, key)
);

alter table seat_board enable row level security;

do $$ begin
  create policy seat_board_read on seat_board for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- 書き込みはこの関数だけ（テーブル直書きはRLSで不可）
create or replace function public.set_seat_board(p_date date, p_key text, p_value integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if p_key not in ('T1', 'T2', 'T3', '和室', 'C') then
    raise exception '席の指定が不正です';
  end if;
  if p_value is null or p_value < 0 or p_value > 10 then
    raise exception '値が不正です';
  end if;
  if p_key <> 'C' and p_value > 1 then
    raise exception '卓は0か1です';
  end if;

  insert into seat_board (biz_date, key, occupied, updated_by)
  values (p_date, p_key, p_value, auth.uid())
  on conflict (biz_date, key)
  do update set occupied = excluded.occupied, updated_by = auth.uid(), updated_at = now();
end;
$$;

grant execute on function public.set_seat_board(date, text, integer) to authenticated;

-- ネット予約の最後の砦にも席ボードを見せる：
-- 「予約は無いが飛び込みで埋まっている席」への確定を防ぐ
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
      -- 席ボード（飛び込み）は予約と重なっている可能性があるので大きい方を採る
      v_used := greatest(v_used, coalesce(
        (select occupied from seat_board where biz_date = p_date and key = 'C'), 0));
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
