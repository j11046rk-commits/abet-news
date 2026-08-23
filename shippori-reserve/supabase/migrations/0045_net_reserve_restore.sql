-- 0045 公開前の総点検で見つかった退行を直す（2026-08-24）
--
-- ★1つ目（最重要）: 0041 の10引数 net_reserve は 0026 の本体から作られていて、
--   そのあと9引数版に積まれた防御が入っていなかった。
--     ・NET_PAUSED（0027 現場の「新規予約停止」）
--     ・NET_EVENT_TODAY（0028 イベント当日はネットで受けない）
--     ・席ボードの新キー対応（0029 'T1-1'〜'Z8' を seat_slots で卓に直す）
--     ・NET_EXCLUSIVE（0037 貸切の日は受けない）
--   アプリは10引数で呼ぶので、本番はずっと防御なしの版が動いていた。
--   ここで「9引数版の完全な本体 + p_line_user_id」として作り直し、
--   9引数版は削除する——2つ並べておくと、また片方だけ直して乖離する。
--
-- ★2つ目: 0044 が set_seat_board を作り直したとき、0033 で入れた
--   has_permission('reservation.write') の判定が auth.uid() チェックに戻っていた。
--   （0033 は「その時点の実体」を文字列置換で直す方式だったため、
--     関数を作り直すと巻き戻る。今回は判定を本体に直書きする）
--
-- ★3つ目: 日またぎで閉じ忘れた席の自動クローズが seat_log しか閉じず、
--   紐づいた予約が「来店中」のまま永遠に残っていた。予約も一緒に会計済へ送る。
--
-- ★4つ目: 会計済→来店中へ戻すとき（90秒undo）、その席に新しいネット予約が
--   入っているとトリガーが例外を出し、席を点けること自体が失敗していた。
--   状態の巻き戻しだけ諦めて、席は必ず点くようにする。

-- ── net_reserve 10引数版を、防御込みの完全な形で作り直す ──
create or replace function public.net_reserve(
  p_date      date,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_party     integer,
  p_name      text,
  p_kana      text,
  p_phone     text,
  p_memo      text,
  p_seat_note text,
  p_line_user_id text
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

  -- 現場がタブレットで「新規予約停止」を押している日は受けない（0027）
  if exists (select 1 from net_pause where biz_date = p_date and ended_at is null) then
    raise exception 'NET_PAUSED';
  end if;

  -- 貸切は店ごと押さえる予約。席の空きにかかわらずネットからは受けない（0037）
  if exists (
    select 1 from reservations
     where biz_date = p_date
       and is_exclusive
       and status in ('tentative','confirmed','seated')
  ) then
    raise exception 'NET_EXCLUSIVE';
  end if;

  v_today := ((now() at time zone 'Asia/Tokyo') - interval '4 hours')::date;

  select * into v_day from business_days where biz_date = p_date;
  v_found := found;

  if v_found and v_day.is_closed then
    raise exception 'NET_CLOSED';
  end if;

  -- イベント営業の当日はネットで受けない（0028。準備数が決まっているため）
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
      -- 席ボードのキーは1席ずつ（'T1-3' 等）なので seat_slots で卓名に直して見る（0029）
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
     source, source_detail, status, seat_note, memo, line_user_id)
  values
    (p_date, p_starts_at, p_ends_at, p_party, btrim(p_name), nullif(btrim(coalesce(p_kana, '')), ''),
     p_phone, 'web_form', 'ネット予約', 'confirmed', p_seat_note,
     nullif(btrim(coalesce(p_memo, '')), ''),
     nullif(btrim(coalesce(p_line_user_id, '')), ''))
  returning reservations.id, reservations.reference;
end;
$$;

revoke execute on function public.net_reserve(
  date, timestamptz, timestamptz, integer, text, text, text, text, text, text
) from public, anon, authenticated;

-- 9引数版は削除。呼ぶ画面はもう無く、残すと次の修正で片方だけ直して再び乖離する
drop function if exists public.net_reserve(
  date, timestamptz, timestamptz, integer, text, text, text, text, text
);

-- 入っていることを確かめる（この4語が無ければ適用が失敗している）
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'net_reserve';
  if v_src is null
     or position('NET_PAUSED' in v_src) = 0
     or position('NET_EVENT_TODAY' in v_src) = 0
     or position('NET_EXCLUSIVE' in v_src) = 0
     or position('seat_slots' in v_src) = 0 then
    raise exception 'net_reserve の復元に失敗しています。';
  end if;
end $$;

-- ── set_seat_board: 0033 の権限判定を本体に直書きして復元 ──
create or replace function public.set_seat_board(p_date date, p_key text, p_value integer, p_resv uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_on boolean;
  r    record;
begin
  -- 0033: ログインの有無ではなく「予約を書ける有効なスタッフか」で見る。
  -- 退職者（is_active=false）や閲覧のみ（viewer）が席を埋めてネット予約を
  -- 止めたり、会計済化で席を再販したりできないように。
  if not public.has_permission('reservation.write') then
    raise exception '権限がありません。';
  end if;
  if p_value is null or p_value < 0 or p_value > 10 then
    raise exception '値が不正です';
  end if;

  /*
   * 日付が変わったのに閉じ忘れている記録は、その営業日の終わり（翌朝4時）で閉じる。
   * 紐づいた予約も一緒に会計済へ送る——閉じ忘れたまま放っておくと、
   * その予約は「来店中」のまま永遠に残り、無断キャンセル率の集計も汚れる。
   */
  with closed as (
    update seat_log
       set left_at = ((biz_date + 1)::timestamp + interval '4 hours') at time zone 'Asia/Tokyo'
     where left_at is null and biz_date < p_date
     returning reservation_id
  )
  update reservations
     set status = 'completed'
   where status = 'seated'
     and id in (select reservation_id from closed where reservation_id is not null);

  v_on := p_value > 0;

  if exists (select 1 from seat_slots where key = p_key) then
    perform set_seat_slot(p_date, p_key, v_on, p_resv);

  elsif p_key = 'C' then
    -- 旧方式：使用席数だけが来る。若い番号から順に埋める（予約の紐づけはできない）
    for r in select key, row_number() over (order by sort_order) as n
               from seat_slots where unit_name = 'カウンター'
    loop
      perform set_seat_slot(p_date, r.key, r.n <= p_value);
    end loop;

  elsif p_key in ('T1', 'T2', 'T3', '和室') then
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

grant execute on function public.set_seat_board(date, text, integer, uuid) to authenticated;

-- ── set_seat_slot: 状態の巻き戻しに失敗しても、席のタップは必ず通す ──
create or replace function public.set_seat_slot(p_date date, p_key text, p_on boolean, p_resv uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot   seat_slots%rowtype;
  v_closed uuid;
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
    /*
     * ミスタップの取り消し：空きに戻した直後（90秒以内）に同じ席を点け直したら、
     * 「まだ居た」とみなして同じ予約に紐づけ直す。
     * 90秒より後は本当に別のお客様（飛び込み）でありうるので、紐づけない。
     */
    if p_resv is null then
      select reservation_id into p_resv
        from seat_log
       where biz_date = p_date and seat_key = p_key
         and reservation_id is not null
         and left_at is not null
         and left_at > now() - interval '90 seconds'
       order by left_at desc
       limit 1;
    end if;

    insert into seat_log (biz_date, seat_key, unit_name, area, seated_by, reservation_id)
    select p_date, p_key, v_slot.unit_name, v_slot.area, auth.uid(), p_resv
     where not exists (
       select 1 from seat_log where biz_date = p_date and seat_key = p_key and left_at is null
     );

    if p_resv is not null then
      /*
       * 会計済からも戻せる＝取り消しの道。ただしその席に新しい予約が入って
       * いると、席の重なりを見張るトリガーが例外を出す。そのときは
       * 巻き戻しだけ諦めて、席を点けること自体は通す——目の前に座っている
       * お客様を画面に出せないほうが、状態が一手ズレるより困る。
       */
      begin
        update reservations set status = 'seated'
         where id = p_resv and status in ('tentative', 'confirmed', 'completed');
      exception when others then
        null;
      end;
    end if;
  else
    update seat_log
       set left_at = now(), left_by = auth.uid()
     where biz_date = p_date and seat_key = p_key and left_at is null
     returning reservation_id into v_closed;

    if v_closed is not null then
      -- 同じ組の席を2つ同時に消したとき、どちらか片方だけが「全部空いた」を見るように
      perform pg_advisory_xact_lock(hashtext('seat-resv-' || v_closed::text));
      if not exists (
        select 1 from seat_log
         where biz_date = p_date and reservation_id = v_closed and left_at is null
      ) then
        update reservations set status = 'completed'
         where id = v_closed and status = 'seated';
      end if;
    end if;
  end if;
end;
$$;

revoke execute on function public.set_seat_slot(date, text, boolean, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
