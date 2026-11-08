-- 0069 棚卸を「月末に1回」から「好きな日に何回でも（基本は毎週日曜）」へ（店主指示 2026-11-09
--      「日曜が暇なことが多いから、毎週日曜に棚卸をする仕組みにしたい」）
--
--   棚卸は「どの営業日の終わりまでの在庫か」（as_of）で持つ。
--     日曜の開店前に数えた → 土曜の営業の終わりまで（as_of = 数えた日の前日）
--     日曜の閉店後に数えた → 日曜の営業の終わりまで（as_of = 数えた日）
--   原価率は「確定した棚卸と次の確定した棚卸の間」ごとに出す（ふだんは1週間）。
--   月の数字は、その月に終わった区間をつないだもの。決算の月末だけは月末にも数えれば、その日で区切れる。
--
--   0065 の月ごとの表（ym が主キー）は作り直す。本番はまだ1件も無い（2026-11-09 確認）。
--   万一行があれば消さずに止める。

do $$
begin
  if exists (select 1 from cost_stocktakes) or exists (select 1 from cost_stock_counts) then
    raise exception '棚卸の行が残っています。作り直す前に中身を移してください（0069）。';
  end if;
end $$;

drop table if exists cost_stock_counts;
drop table if exists cost_stocktakes;

create table cost_stocktakes (
  as_of       date primary key,                        -- この営業日の終わりまでの在庫
  counted_on  date not null,                           -- 数えた日
  timing      text not null check (timing in ('before_open', 'after_close')),  -- 開店前 / 閉店後
  status      text not null default 'draft' check (status in ('draft', 'done')),
  total_ex    integer,                                 -- 確定時の在庫額（税抜）
  done_by     uuid references profiles(id),
  done_at     timestamptz,
  created_by  uuid references profiles(id) default auth.uid(),
  updated_at  timestamptz not null default now(),
  check ((status = 'done') = (total_ex is not null)),
  check (as_of = case when timing = 'after_close' then counted_on else counted_on - 1 end)
);

create table cost_stock_counts (
  as_of       date not null references cost_stocktakes(as_of) on delete cascade,
  item_id     uuid not null references cost_stock_items(id),
  qty         numeric(10, 2) not null check (qty >= 0 and qty <= 100000),
  unit_price  integer not null check (unit_price between 0 and 1000000), -- 数えた時点の単価（後で単価を変えても過去の在庫額は動かない）
  counted_by  uuid references profiles(id) default auth.uid(),
  counted_at  timestamptz not null default now(),
  primary key (as_of, item_id)
);

drop trigger if exists cost_stocktakes_touch on cost_stocktakes;
create trigger cost_stocktakes_touch before update on cost_stocktakes
  for each row execute function public.cost_touch();

-- 確定した棚卸の数は直せない（直すときは確定を外す）。確定した棚卸そのものも消せない
create or replace function public.cost_counts_guard() returns trigger
language plpgsql as $$
declare v_status text;
begin
  select status into v_status from cost_stocktakes
   where as_of = coalesce(new.as_of, old.as_of);
  if v_status = 'done' then
    raise exception '確定した棚卸は直せません。先に確定を外してください。';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists cost_counts_guard on cost_stock_counts;
create trigger cost_counts_guard before insert or update or delete on cost_stock_counts
  for each row execute function public.cost_counts_guard();

create or replace function public.cost_stocktakes_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'done' then
      raise exception '確定した棚卸は消せません。先に確定を外してください。';
    end if;
    return old;
  end if;
  -- 数えた日・タイミング（＝どこで区切るか）は、作ったあと変えない（間違えたら下書きを消して作り直す）
  if new.as_of <> old.as_of or new.counted_on <> old.counted_on or new.timing <> old.timing then
    raise exception '数えた日・開店前／閉店後は変えられません。下書きを消して作り直してください。';
  end if;
  return new;
end $$;

drop trigger if exists cost_stocktakes_guard on cost_stocktakes;
create trigger cost_stocktakes_guard before update or delete on cost_stocktakes
  for each row execute function public.cost_stocktakes_guard();

alter table cost_stocktakes   enable row level security;
alter table cost_stock_counts enable row level security;

do $$
declare t text;
begin
  foreach t in array array['cost_stocktakes', 'cost_stock_counts'] loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format('create policy %1$s_read on %1$s for select to authenticated using (has_permission(''cost.read''))', t);
    execute format('drop policy if exists %1$s_write on %1$s', t);
    execute format(
      'create policy %1$s_write on %1$s for all to authenticated using (has_permission(''cost.write'')) with check (has_permission(''cost.write''))', t);
  end loop;
end $$;

comment on table cost_stocktakes is '棚卸（基本は毎週日曜）。as_of＝この営業日の終わりまでの在庫。原価率は確定した棚卸どうしの間ごと';
