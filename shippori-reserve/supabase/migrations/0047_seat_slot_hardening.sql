-- 0047 運用2日目の点検で見つかった席ログの縁を締める（2026-08-25）
--
-- ①「ご来店」確定と同時に別端末が同じ席を点けていた場合、
--   これまでは seat_log に紐づき行を書けないまま予約だけ seated になり、
--   「永遠に来店中」の予約が残った。実際に紐づけを書けたときだけ seated へ送る。
--   既に開いている行が無名（飛び込み扱い）なら、そこに紐づけを書き込んで拾う。
--
-- ② タブレットのダイアログで「別のお客様（飛び込み）」と明示されたのに、
--   90秒以内の紐づけ直し（ミスタップ救済）が黙って予約に紐づけてしまっていた。
--   飛び込みの明示（p_walkin）をDBまで伝え、そのときは紐づけ直しをしない。
--
-- 引数が増えるため旧4引数版は削除して作り直す（既定値があるので、
-- 配り替え前の画面から4引数で呼ばれても動く＝マイグレーション先行で安全）。

drop function if exists public.set_seat_slot(date, text, boolean, uuid);

create function public.set_seat_slot(
  p_date date, p_key text, p_on boolean, p_resv uuid default null, p_walkin boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot   seat_slots%rowtype;
  v_closed uuid;
  v_linked integer := 0;
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
     * ★「飛び込み」と明示されたとき（p_walkin）はやらない——申告を機械が上書きしない。
     */
    if p_resv is null and not p_walkin then
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
    get diagnostics v_linked = row_count;

    if p_resv is not null then
      -- 挿入できなかった＝既に誰かが点けている。開いている行が無名なら、そこへ紐づけを書く
      if v_linked = 0 then
        update seat_log set reservation_id = p_resv
         where biz_date = p_date and seat_key = p_key
           and left_at is null and reservation_id is null;
        get diagnostics v_linked = row_count;
      end if;

      /*
       * 紐づけを実際に書けたときだけ「来店中」へ送る。
       * 書けていないのに送ると、退店タップで拾えない「永遠に来店中」が残る。
       * 席の重なりトリガーが例外を出したら、巻き戻しだけ諦めて席は点ける。
       */
      if v_linked > 0 then
        begin
          update reservations set status = 'seated'
           where id = p_resv and status in ('tentative', 'confirmed', 'completed');
        exception when others then
          null;
        end;
      end if;
    end if;
  else
    update seat_log
       set left_at = now(), left_by = auth.uid()
     where biz_date = p_date and seat_key = p_key and left_at is null
     returning reservation_id into v_closed;

    if v_closed is not null then
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

revoke execute on function public.set_seat_slot(date, text, boolean, uuid, boolean) from public, anon, authenticated;

-- ── set_seat_board にも p_walkin を通す ─────────────────────
drop function if exists public.set_seat_board(date, text, integer, uuid);

create function public.set_seat_board(
  p_date date, p_key text, p_value integer, p_resv uuid default null, p_walkin boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_on boolean;
  r    record;
begin
  if not public.has_permission('reservation.write') then
    raise exception '権限がありません。';
  end if;
  if p_value is null or p_value < 0 or p_value > 10 then
    raise exception '値が不正です';
  end if;

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
    perform set_seat_slot(p_date, p_key, v_on, p_resv, p_walkin);

  elsif p_key = 'C' then
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

grant execute on function public.set_seat_board(date, text, integer, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
