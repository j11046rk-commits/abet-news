-- 0044 お帰りを記録して、空いた席をその晩もう一度売る（店主指定 2026-08-22）
--
-- これまで「帰った」がどこにも記録されず、退店後に席ボタンを空きへ戻すと
-- 予約の下書き（点線）が復活して名前が残り続けていた。
--
-- 方針は店主の言葉どおり「ネットで即時予約できることが最大のメリット。
-- そのためにタブレットを常設してリアルタイムの空席を管理している」——
-- つまり退店した席は、その晩もう一度ネットに開放する（B案）。
--
-- 仕組み：席ボタンのタップを予約と紐づける。
--   点線の席をタップして着席   → その予約を「来店中(seated)」に
--   その組の席を全部空きに戻す → 「会計済(completed)」に
-- 会計済はネット予約の空席判定（net_reserve・assert_seat_free とも
-- status in ('tentative','confirmed','seated') で見る）から自然に外れるので、
-- 判定側は一切書き換えない。増やすのは「会計済へ自動で送る道」だけ。
--
-- ★「1つの席は1晩1組」の先売りルールは変えない。前もって同じ席に2組は
--   入れられないまま。開くのは、実際にお帰りになって席ボタンが戻った後だけ。

-- ── どの席に誰の予約が座ったか ─────────────────────────────
alter table seat_log add column if not exists reservation_id uuid references reservations(id) on delete set null;
create index if not exists seat_log_resv on seat_log (reservation_id) where reservation_id is not null;

-- ── 会計済は席を持たない（トリガーの早期退出に追加）────────
-- これが無いと、会計済へ変える更新そのものが席の重なり検査を通ることになり、
-- 万一の重なり時に「お帰りの記録」が例外で止まる。帰る人を止める理由は無い。
create or replace function public.assert_seat_free()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_mode text;
  v_name text;
  v_shared boolean;
  v_cap int;
  v_used int;
begin
  -- キャンセル・無断キャンセル・会計済は席を持たない
  if new.status in ('cancelled', 'no_show', 'completed') then
    return new;
  end if;

  select mode into v_mode from business_days where biz_date = new.biz_date;
  if v_mode = 'event' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('net-reserve-' || new.biz_date::text));

  if exists (
    select 1 from reservations r
     where r.biz_date = new.biz_date
       and r.id <> new.id
       and r.is_exclusive
       and r.status in ('tentative','confirmed','seated')
  ) then
    raise exception 'この日は貸切のご予約が入っています。';
  end if;

  foreach v_name in array
    coalesce(
      (select array_agg(t) from unnest(string_to_array(coalesce(new.seat_note, ''), '＋')) x(t)
        where btrim(t) <> '' and btrim(t) not in ('指定なし', '貸切')),
      '{}'::text[]
    )
  loop
    v_name := btrim(v_name);
    select is_shared, capacity into v_shared, v_cap
      from seat_units where name = v_name and is_active;
    if not found then
      continue;
    end if;

    if v_shared then
      select coalesce(sum(r.party_size), 0) into v_used
        from reservations r
       where r.biz_date = new.biz_date
         and r.id <> new.id
         and r.status in ('tentative','confirmed','seated')
         and v_name = any (string_to_array(coalesce(r.seat_note, ''), '＋'));
      if v_used + new.party_size > v_cap then
        raise exception '「%」の残りが足りません（残り % 席）。', v_name, greatest(0, v_cap - v_used);
      end if;
    else
      if exists (
        select 1 from reservations r
         where r.biz_date = new.biz_date
           and r.id <> new.id
           and r.status in ('tentative','confirmed','seated')
           and v_name = any (string_to_array(coalesce(r.seat_note, ''), '＋'))
      ) then
        raise exception '「%」はこの日すでに予約が入っています。', v_name;
      end if;
    end if;
  end loop;

  return new;
end;
$$;

-- ── 1席ぶんの記録（内部用）：予約と紐づけられるように ──────
-- 引数が増えるので、旧3引数版は消してから作る（残すと同名2つで呼び分けが曖昧になる）
drop function if exists public.set_seat_slot(date, text, boolean);

create function public.set_seat_slot(p_date date, p_key text, p_on boolean, p_resv uuid default null)
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
      -- 会計済からも戻せる＝取り消しの道。席の重なりがあればトリガーが止める
      update reservations set status = 'seated'
       where id = p_resv and status in ('tentative', 'confirmed', 'completed');
    end if;
  else
    update seat_log
       set left_at = now(), left_by = auth.uid()
     where biz_date = p_date and seat_key = p_key and left_at is null
     returning reservation_id into v_closed;

    if v_closed is not null then
      -- 同じ組の席を2つ同時に消したとき、どちらか片方だけが「全部空いた」を見るように
      -- 予約単位で直列化する（両方が互いの未確定の更新を見て、誰も会計済にしない事故を防ぐ）
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

-- ── 席ボードの書き込み口：予約IDを受け取れるように ─────────
-- 旧3引数版は消し、4引数目に既定値を持たせて作り直す。既定値があるので、
-- 更新前のタブレット（3引数で呼ぶ）もそのまま動く＝マイグレーション先行で安全。
drop function if exists public.set_seat_board(date, text, integer);

create function public.set_seat_board(p_date date, p_key text, p_value integer, p_resv uuid default null)
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

  update seat_log
     set left_at = ((biz_date + 1)::timestamp + interval '4 hours') at time zone 'Asia/Tokyo'
   where left_at is null and biz_date < p_date;

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

-- PostgRESTに関数の入れ替えを知らせる（Supabaseは自動でも拾うが、念のため）
notify pgrst, 'reload schema';
