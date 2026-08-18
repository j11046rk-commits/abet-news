-- 0039 席の重なりをDBで止める（同時入力への最後の砦）
--
-- これまで席の重なりは、画面とサーバーアクションでしか見ていなかった。
-- 「読んで、空いていることを確かめて、入れる」の3手の間に別の人が入ると、
-- 2人とも検査を通り、2人とも入る。人が5人の店では滅多に起きないが、
-- 起きたときに気づく手がかりが一切残らない——当日、同じ席に2組が来る。
--
-- ネット予約（net_reserve）は advisory lock を取って直列化しているのに、
-- スタッフ側は素通しだった。つまり「スタッフ2人が同時」だけでなく
-- 「スタッフとネットのお客様が同時」でも重なりうる。
--
-- ★同じ鍵（net-reserve-<日付>）を使う。
--   別の鍵にすると、スタッフ側とネット側が互いを待たず、
--   いちばん起きやすい組み合わせが素通りしてしまう。
--
-- ★判定は「1つの席は1晩1組」（店主指定・繁忙日も同じ）。
--   時間帯の重なりは見ない。アプリ側（lib/seats.ts）と同じ物差しにする。

create or replace function public.assert_seat_free()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_mode text;
  v_name text;
  v_shared boolean;
  v_cap int;
  v_used int;
begin
  -- キャンセル・無断キャンセルは席を持たない
  if new.status in ('cancelled', 'no_show') then
    return new;
  end if;

  -- イベント営業の日は席を使わない（定員で見る）
  select mode into v_mode from business_days where biz_date = new.biz_date;
  if v_mode = 'event' then
    return new;
  end if;

  -- ここから先は1日ぶんを直列化する。ネット予約と同じ鍵を使う。
  perform pg_advisory_xact_lock(hashtext('net-reserve-' || new.biz_date::text));

  -- 貸切はお店ごと押さえる。他に予約があれば入れられないし、逆も入れられない。
  if exists (
    select 1 from reservations r
     where r.biz_date = new.biz_date
       and r.id <> new.id
       and r.is_exclusive
       and r.status in ('tentative','confirmed','seated')
  ) then
    raise exception 'この日は貸切のご予約が入っています。';
  end if;

  -- 席メモに書かれた席を1つずつ見る。「指定なし」「貸切」は席を占めない。
  -- coalesce を外すと、席メモが「貸切」「指定なし」だけの予約で
  -- array_agg が null を返し、FOREACH がそこで落ちる（＝貸切が登録できなくなる）。
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
      continue; -- 席マスタに無い名前は判定しない（自由記述の余地を残す）
    end if;

    if v_shared then
      -- カウンターは人数で見る。自分以外の合計＋自分が定員を超えたら拒否。
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
      -- 卓・和室は1晩1組
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

comment on function public.assert_seat_free() is
  '席の重なりを止める。ネット予約と同じ advisory lock で1日ぶんを直列化する';

-- 席・日付・人数・状態が変わったときだけ見る。
-- メモの書き換えのたびに走らせると、無関係な編集が重い判定を引く。
drop trigger if exists reservations_seat_guard on reservations;
create trigger reservations_seat_guard
  before insert or update of biz_date, seat_note, party_size, status, is_exclusive
  on reservations
  for each row execute function public.assert_seat_free();

-- 入ったことを確かめる
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'reservations_seat_guard' and not tgisinternal
  ) then
    raise exception '席の重なりを止めるトリガーが入っていません。';
  end if;
end $$;
