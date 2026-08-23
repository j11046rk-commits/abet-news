-- 0029 席を1席ずつ記録し、着席・退席を履歴として残す
--
-- これまで席ボードは「いま埋まっているか」しか持っていなかった（上書きなので履歴が消える）。
-- 客席稼働率や時間帯別の滞在時間を後から見られるように、タップのたびに
-- 「座った時刻・立った時刻」を1行として積み上げる。
--
-- あわせて、テーブルと和室も卓ごとではなく席ごとに扱う。
-- ただし**予約の空席判定は今までどおり「1席でも埋まっていればその卓は満席」**（店主指定）。
--
-- いちばん危険なのは、キーの体系を変えた瞬間に空席判定が
-- 「埋まっている卓を空きと誤認する」ことなので、
-- 席キー → 卓名 の対応表（seat_slots）をDBに1つだけ置き、判定はすべてそれを通す。

-- ── 席マスタ ─────────────────────────────────────────────
create table if not exists seat_slots (
  key        text primary key,   -- 'C1' 'T1-3' 'Z5'
  unit_name  text not null,      -- seat_units.name と一致（'カウンター' 'T1' '和室'）
  area       text not null check (area in ('counter', 'table', 'private')),
  label      text not null,      -- ボードに出す短い名前
  sort_order integer not null default 0
);

insert into seat_slots (key, unit_name, area, label, sort_order)
select 'C' || n, 'カウンター', 'counter', n::text, n
  from generate_series(1, 10) as n
on conflict (key) do nothing;

insert into seat_slots (key, unit_name, area, label, sort_order)
select 'T' || t || '-' || n, 'T' || t, 'table', n::text, t * 10 + n
  from generate_series(1, 3) as t, generate_series(1, 6) as n
on conflict (key) do nothing;

insert into seat_slots (key, unit_name, area, label, sort_order)
select 'Z' || n, '和室', 'private', n::text, 100 + n
  from generate_series(1, 8) as n
on conflict (key) do nothing;

alter table seat_slots enable row level security;
do $$ begin
  create policy seat_slots_read on seat_slots for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- ── 着席のセッション ──────────────────────────────────────
create table if not exists seat_log (
  id        bigint generated always as identity primary key,
  biz_date  date not null,
  seat_key  text not null,
  unit_name text not null,
  area      text not null,
  seated_at timestamptz not null default now(),
  left_at   timestamptz,          -- null なら着席中
  seated_by uuid references profiles(id),
  left_by   uuid references profiles(id)
);

-- 同じ席で「開いたままの記録」は1つだけ
create unique index if not exists seat_log_open_one
  on seat_log (biz_date, seat_key) where left_at is null;
create index if not exists seat_log_biz_date on seat_log (biz_date);

alter table seat_log enable row level security;
do $$ begin
  create policy seat_log_read on seat_log for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- ── 1席ぶんの記録（内部用）────────────────────────────────
create or replace function public.set_seat_slot(p_date date, p_key text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot seat_slots%rowtype;
begin
  select * into v_slot from seat_slots where key = p_key;
  if not found then
    raise exception '席の指定が不正です';
  end if;

  insert into seat_board (biz_date, key, occupied, updated_by)
  values (p_date, p_key, case when p_on then 1 else 0 end, auth.uid())
  on conflict (biz_date, key)
  do update set occupied = excluded.occupied, updated_by = auth.uid(), updated_at = now();

  if p_on then
    -- すでに座っている記録があるなら二重に始めない
    insert into seat_log (biz_date, seat_key, unit_name, area, seated_by)
    select p_date, p_key, v_slot.unit_name, v_slot.area, auth.uid()
     where not exists (
       select 1 from seat_log where biz_date = p_date and seat_key = p_key and left_at is null
     );
  else
    update seat_log
       set left_at = now(), left_by = auth.uid()
     where biz_date = p_date and seat_key = p_key and left_at is null;
  end if;
end;
$$;

-- ── 席ボードの書き込み口（署名は変えない）─────────────────
-- 旧キー（'T1' '和室' 'C'）で来ても席単位へ翻訳して受ける。
-- こうしておくと、更新前のタブレットが残っていても記録が壊れない。
create or replace function public.set_seat_board(p_date date, p_key text, p_value integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_on boolean;
  r    record;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if p_value is null or p_value < 0 or p_value > 10 then
    raise exception '値が不正です';
  end if;

  -- 日付が変わったのに閉じ忘れている記録は、その営業日の終わり（翌朝4時）で閉じる
  update seat_log
     set left_at = ((biz_date + 1)::timestamp + interval '4 hours') at time zone 'Asia/Tokyo'
   where left_at is null and biz_date < p_date;

  v_on := p_value > 0;

  if exists (select 1 from seat_slots where key = p_key) then
    perform set_seat_slot(p_date, p_key, v_on);

  elsif p_key = 'C' then
    -- 旧方式：使用席数だけが来る。若い番号から順に埋める
    for r in select key, row_number() over (order by sort_order) as n
               from seat_slots where unit_name = 'カウンター'
    loop
      perform set_seat_slot(p_date, r.key, r.n <= p_value);
    end loop;

  elsif p_key in ('T1', 'T2', 'T3', '和室') then
    -- 旧方式：卓ごと。卓が使用中＝その卓の席は全部埋まっている、として翻訳する
    for r in select key from seat_slots where unit_name = p_key
    loop
      perform set_seat_slot(p_date, r.key, v_on);
    end loop;
    delete from seat_board where biz_date = p_date and key = p_key;

  else
    raise exception '席の指定が不正です';
  end if;
end;
$$;

grant execute on function public.set_seat_board(date, text, integer) to authenticated;
revoke execute on function public.set_seat_slot(date, text, boolean) from public, anon, authenticated;

-- ── 既存データの引っ越し ──────────────────────────────────
-- 今日以降の旧キー行を席単位に展開して、旧行は消す。
-- （消さないと、新しい画面からは触れない「一晩中埋まったままの卓」になる）
-- 過去日はその晩の記録なのでそのまま残す。
do $$
declare
  v_today date := ((now() at time zone 'Asia/Tokyo') - interval '4 hours')::date;
  b record;
  s record;
begin
  for b in select * from seat_board
            where biz_date >= v_today and key in ('T1', 'T2', 'T3', '和室', 'C')
  loop
    if b.key = 'C' then
      for s in select key, row_number() over (order by sort_order) as n
                 from seat_slots where unit_name = 'カウンター'
      loop
        insert into seat_board (biz_date, key, occupied)
        values (b.biz_date, s.key, case when s.n <= b.occupied then 1 else 0 end)
        on conflict (biz_date, key) do update
          set occupied = greatest(seat_board.occupied, excluded.occupied);
      end loop;
    else
      for s in select key from seat_slots where unit_name = b.key
      loop
        insert into seat_board (biz_date, key, occupied)
        values (b.biz_date, s.key, b.occupied)
        on conflict (biz_date, key) do update
          set occupied = greatest(seat_board.occupied, excluded.occupied);
      end loop;
    end if;
    delete from seat_board where biz_date = b.biz_date and key = b.key;
  end loop;
end $$;

-- ── 最後の砦：空席判定を席マスタ経由にする ────────────────
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

  if exists (select 1 from net_pause where biz_date = p_date and ended_at is null) then
    raise exception 'NET_PAUSED';
  end if;

  v_today := ((now() at time zone 'Asia/Tokyo') - interval '4 hours')::date;

  select * into v_day from business_days where biz_date = p_date;
  v_found := found;

  if v_found and v_day.is_closed then
    raise exception 'NET_CLOSED';
  end if;

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
      -- 席ボード（飛び込み）は予約と重なっている可能性があるので大きい方を採る
      v_used := greatest(
        v_used,
        coalesce((select occupied from seat_board where biz_date = p_date and key = 'C'), 0),
        coalesce((select count(*) from seat_board b
                    join seat_slots s on s.key = b.key
                   where b.biz_date = p_date and b.occupied > 0
                     and s.unit_name = p_seat_note), 0));
      if v_used + p_party > v_unit.capacity then
        raise exception 'NET_FULL';
      end if;
    else
      -- 1席でも埋まっていれば、その卓は満席として扱う（店主指定）。
      -- coalesce で、席マスタに無い旧キー（'T1' '和室'）はキー自体を卓名とみなす
      if exists (
        select 1 from reservations
         where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
           and seat_note is not null
           and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'))
      ) or exists (
        select 1 from seat_board b
          left join seat_slots s on s.key = b.key
         where b.biz_date = p_date and b.occupied > 0
           and coalesce(s.unit_name, b.key) = p_seat_note
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
