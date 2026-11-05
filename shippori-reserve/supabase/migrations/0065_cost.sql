-- 0065 原価（仕入・棚卸・ロス）
--
-- 原価率＝（月初の在庫 ＋ その月の仕入 − 月末の在庫）÷ その月の売上（どちらも税抜）。
-- 税理士の月次報告と同じ物差しにするため、仕入も売上も税抜で持つ。
--
-- 決めごと
--   ・仕入は「書類1枚＝1行」。1枚のレシートに食材と消耗品が混ざる（スーパー）ので、
--     区分ごとの税抜額を列で持つ（食材・酒飲料・消耗品・その他）。
--   ・月締めの業者は請求書、それ以外は納品書かレシート。計上日（book_date）で月に振り分ける。
--     請求書は締め日を計上日にする。同じ業者の納品書と請求書が同じ月に両方あると二重になるので、
--     画面で警告する（DBは止めない：返品や追加請求で正しく両方ある月もある）。
--   ・棚卸は月末に1回。数えていない品は空欄（＝0ではない）。確定した月だけ在庫額として使う。
--   ・写真は非公開の置き場（cost-photos）。見るのはサーバーが短い時間だけ有効なURLを出す。
--   ・閲覧・記録は cost.read / cost.write（オーナー・店長・事務）。給与は一切扱わない。
--
-- 何も自動で作らない：仕入・棚卸の品目・ロスは、この移行では1行も入れない。

-- ── 権限 ───────────────────────────────────────────────
insert into permissions (code, label) values
  ('cost.read',  '原価の閲覧（仕入・棚卸・ロス・原価率）'),
  ('cost.write', '仕入・棚卸・ロスの記録')
on conflict (code) do nothing;

insert into role_permissions (role, permission)
select v.r::user_role, v.p
from (values
  ('owner',   'cost.read'), ('owner',   'cost.write'),
  ('manager', 'cost.read'), ('manager', 'cost.write'),
  ('jimu',    'cost.read'), ('jimu',    'cost.write')
) v(r, p)
on conflict do nothing;

-- ── 仕入（書類1枚＝1行）──────────────────────────────────────
create table if not exists cost_purchases (
  id           uuid primary key default gen_random_uuid(),
  book_date    date not null,                         -- 計上日（納品日・購入日。請求書は締め日）
  vendor       text not null check (length(btrim(vendor)) between 1 and 80),
  doc_kind     text not null check (doc_kind in ('slip', 'invoice', 'receipt')),
                                                      -- 納品書 / 請求書（月締め）/ レシート（現金・カード）
  food_ex      integer not null default 0 check (food_ex     between -10000000 and 10000000), -- 食材（税抜）
  drink_ex     integer not null default 0 check (drink_ex    between -10000000 and 10000000), -- 酒・飲料（税抜）
  supplies_ex  integer not null default 0 check (supplies_ex between -10000000 and 10000000), -- 消耗品（税抜）
  other_ex     integer not null default 0 check (other_ex    between -10000000 and 10000000), -- その他（税抜）
  total_in     integer check (total_in between -20000000 and 20000000),                       -- 書類の合計（税込・照合用）
  period_from  date,                                  -- 請求書の対象期間
  period_to    date,
  memo         text check (memo is null or length(memo) <= 500),
  photo_path   text,
  ai_read      boolean not null default false,        -- AIの読み取りから作った（人が確認して保存）
  created_by   uuid references profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_by   uuid references profiles(id),
  updated_at   timestamptz not null default now(),
  check (period_from is null or period_to is null or period_from <= period_to)
);
create index if not exists cost_purchases_book_date on cost_purchases (book_date);

-- ── 棚卸の品目（前の月の品目と単価を引き継ぐ）────────────────────────
create table if not exists cost_stock_items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 60),
  unit        text not null default '個' check (length(unit) between 1 and 10),
  unit_price  integer not null check (unit_price between 0 and 1000000),  -- 税抜の単価（円）
  category    text not null default 'food' check (category in ('food', 'drink')),
  sort        integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── 棚卸（月に1回）──────────────────────────────────────────
create table if not exists cost_stocktakes (
  ym          text primary key check (ym ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status      text not null default 'draft' check (status in ('draft', 'done')),
  total_ex    integer,                                -- 確定時の在庫額（税抜）
  done_by     uuid references profiles(id),
  done_at     timestamptz,
  updated_at  timestamptz not null default now(),
  check ((status = 'done') = (total_ex is not null))
);

create table if not exists cost_stock_counts (
  ym          text not null references cost_stocktakes(ym) on delete cascade,
  item_id     uuid not null references cost_stock_items(id),
  qty         numeric(10, 2) not null check (qty >= 0 and qty <= 100000),
  unit_price  integer not null check (unit_price between 0 and 1000000), -- 数えた時点の単価（後で単価を変えても過去の在庫額は動かない）
  counted_by  uuid references profiles(id) default auth.uid(),
  counted_at  timestamptz not null default now(),
  primary key (ym, item_id)
);

-- ── ロス（捨てたもの）──────────────────────────────────────────
create table if not exists cost_losses (
  id          uuid primary key default gen_random_uuid(),
  biz_date    date not null,
  item        text not null check (length(btrim(item)) between 1 and 60),
  amount_ex   integer not null check (amount_ex between 0 and 1000000), -- 仕入値ベースの損失額（税抜・目安）
  reason      text not null check (reason in ('expired', 'overprep', 'mistake', 'damaged', 'other')),
                                                      -- 期限切れ / 作りすぎ / 調理ミス / 傷み・破損 / その他
  memo        text check (memo is null or length(memo) <= 300),
  photo_path  text,
  created_by  uuid references profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists cost_losses_biz_date on cost_losses (biz_date);

-- ── 更新者・更新時刻 ─────────────────────────────────────────
create or replace function public.cost_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if tg_table_name = 'cost_purchases' then
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.created_by := old.created_by;   -- 作った人は書き換えさせない
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists cost_purchases_touch on cost_purchases;
create trigger cost_purchases_touch before update on cost_purchases
  for each row execute function public.cost_touch();
drop trigger if exists cost_stock_items_touch on cost_stock_items;
create trigger cost_stock_items_touch before update on cost_stock_items
  for each row execute function public.cost_touch();
drop trigger if exists cost_stocktakes_touch on cost_stocktakes;
create trigger cost_stocktakes_touch before update on cost_stocktakes
  for each row execute function public.cost_touch();

-- 確定した棚卸の数は直せない（直すときは確定を外す＝オーナー・店長の操作）
create or replace function public.cost_counts_guard() returns trigger
language plpgsql as $$
declare v_status text;
begin
  select status into v_status from cost_stocktakes
   where ym = coalesce(new.ym, old.ym);
  if v_status = 'done' then
    raise exception '確定した棚卸は直せません。先に確定を外してください。';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists cost_counts_guard on cost_stock_counts;
create trigger cost_counts_guard before insert or update or delete on cost_stock_counts
  for each row execute function public.cost_counts_guard();

-- ── RLS ───────────────────────────────────────────────
alter table cost_purchases    enable row level security;
alter table cost_stock_items  enable row level security;
alter table cost_stocktakes   enable row level security;
alter table cost_stock_counts enable row level security;
alter table cost_losses       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['cost_purchases', 'cost_stock_items', 'cost_stocktakes', 'cost_stock_counts', 'cost_losses'] loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format('create policy %1$s_read on %1$s for select to authenticated using (has_permission(''cost.read''))', t);
    execute format('drop policy if exists %1$s_write on %1$s', t);
    execute format(
      'create policy %1$s_write on %1$s for all to authenticated using (has_permission(''cost.write'')) with check (has_permission(''cost.write''))', t);
  end loop;
end $$;

-- ── 写真の置き場（非公開）────────────────────────────────────
-- 公開の読み取りポリシーは置かない。アップロードと表示はサーバー（管理キー）だけが行う。
insert into storage.buckets (id, name, public)
values ('cost-photos', 'cost-photos', false)
on conflict (id) do update set public = false;
