-- 0021 ネット予約（HP公開フォーム）
--
-- お客様向けの予約はこの関数だけが書き込む。判定と登録を1トランザクションで行い、
-- 同じ営業日への同時送信は advisory lock で直列化する。
-- 「画面では空いて見えたのに、押した瞬間に別の人が取っていた」場合はエラーで返り、
-- 席の二重予約はDBの中で構造的に起きない。
--
-- 実行権限は service_role のみ（アプリのサーバーAPIからだけ呼べる。ブラウザから直接は呼べない）。

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

  -- 同じ営業日の判定を直列化する（別の日どうしは並行してよい）
  perform pg_advisory_xact_lock(hashtext('net-reserve-' || p_date::text));

  select * into v_day from business_days where biz_date = p_date;

  if found and v_day.is_closed then
    raise exception 'NET_CLOSED';
  end if;

  if found and v_day.mode = 'event' then
    -- イベント営業は席を持たず定員で見る
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
    if v_unit.is_shared then
      -- カウンター：残席で見る
      select coalesce(sum(party_size), 0) into v_used
        from reservations
       where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
         and seat_note is not null
         and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'));
      if v_used + p_party > v_unit.capacity then
        raise exception 'NET_FULL';
      end if;
    else
      -- テーブル・和室：1晩1組（アプリ側と同じ判定）
      if exists (
        select 1 from reservations
         where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
           and seat_note is not null
           and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'))
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

revoke all on function public.net_reserve(date, timestamptz, timestamptz, integer, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.net_reserve(date, timestamptz, timestamptz, integer, text, text, text, text, text)
  to service_role;
