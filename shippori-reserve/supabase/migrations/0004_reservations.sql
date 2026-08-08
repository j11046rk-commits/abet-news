-- 0004 予約
-- docs/03-database.md §3-6 に対応。

create table if not exists reservations (
  id               uuid primary key default gen_random_uuid(),
  reference        text not null unique,                 -- R-2608-0142（電話口で言える番号）
  biz_date         date not null references business_days(biz_date),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,

  party_size       integer not null check (party_size between 1 and 100),
  customer_name    text not null check (length(btrim(customer_name)) > 0),
  customer_kana    text,
  phone            text,

  -- ▼ 流入元（必須。ここが集計の根幹）
  source            reservation_source not null,
  source_profile_id uuid references profiles(id),        -- owner_direct のとき「誰経由か」
  source_detail     text,                                -- IGアカウント名・紹介者名など
  external_ref      text,                                -- LINEのmessageId等（Phase 5の受信箱と突き合わせる）

  status           reservation_status not null default 'tentative',
  is_exclusive     boolean not null default false,       -- 貸切（25名〜）
  course_id        uuid references courses(id),
  drink_plan       boolean not null default false,
  budget_yen       integer check (budget_yen is null or budget_yen >= 0),
  needs_invoice    boolean not null default false,
  invoice_name     text,
  allergy          text,
  memo             text,

  -- Phase 1 の席欄。ここは「T1」「カウンター」等をメモとして書くだけで、
  -- 席の重複判定は行わない。本格的な席管理は Phase 2（reservation_seats）で入れる。
  seat_note        text,

  cancelled_at     timestamptz,
  cancel_reason    text,
  created_by       uuid references profiles(id),
  updated_by       uuid references profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint reservations_time_order check (ends_at > starts_at),
  -- オーナー直通なら誰経由かを必ず記録する
  constraint reservations_owner_direct_needs_person
    check (source <> 'owner_direct' or source_profile_id is not null),
  -- キャンセルは理由を残す
  constraint reservations_cancel_reason
    check (status <> 'cancelled' or (cancel_reason is not null and length(btrim(cancel_reason)) > 0))
);

create index if not exists reservations_bizdate_idx on reservations (biz_date, starts_at);
create index if not exists reservations_status_idx  on reservations (status)
  where status in ('tentative', 'confirmed', 'seated');
create index if not exists reservations_source_idx  on reservations (source, biz_date);
create index if not exists reservations_phone_idx   on reservations (phone);
create index if not exists reservations_name_trgm   on reservations using gin (customer_name gin_trgm_ops);

-- ── 受付番号の採番（R-YYMM-NNNN）─────────────────────────────
create table if not exists reference_counters (
  period text primary key,
  n      integer not null default 0
);

-- security definer：reference_counters は RLS でスタッフに直接触らせない。
-- 採番はこの関数の中でだけ起きる。
create or replace function public.assign_reference()
returns trigger language plpgsql security definer set search_path = public as $$
declare p text; v int;
begin
  if new.reference is not null then return new; end if;
  p := to_char(new.biz_date, 'YYMM');
  insert into reference_counters (period, n) values (p, 1)
    on conflict (period) do update set n = reference_counters.n + 1
    returning n into v;
  new.reference := 'R-' || p || '-' || lpad(v::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists reservations_assign_reference on reservations;
create trigger reservations_assign_reference
  before insert on reservations for each row execute function assign_reference();

-- NOT NULL は BEFORE トリガの後に検査される。
-- したがってアプリは reference を渡さなくてよい（トリガが埋める）。

-- biz_date の行を必ず存在させる（営業モードが常に解決できる状態を保つ）
create or replace function public.reservations_ensure_day()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_business_day(new.biz_date);
  return new;
end;
$$;

drop trigger if exists reservations_ensure_day_trg on reservations;
create trigger reservations_ensure_day_trg
  before insert or update of biz_date on reservations
  for each row execute function reservations_ensure_day();

-- 更新時刻とキャンセル時刻の面倒を見る
create or replace function public.reservations_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
  end if;
  if new.status <> 'cancelled' then
    new.cancelled_at := null;
    new.cancel_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists reservations_touch_trg on reservations;
create trigger reservations_touch_trg
  before update on reservations for each row execute function reservations_touch();
