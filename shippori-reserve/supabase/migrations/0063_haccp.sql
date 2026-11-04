-- 0063 衛生管理（HACCPの考え方を取り入れた衛生管理）
--
-- 小規模な一般飲食店向けの手引書（日本食品衛生協会作成・厚生労働省確認）の流れ
--   計画を作る → スタッフに周知 → 実施・記録 → 振り返り・見直し
-- を、この予約システムの中で回せるようにする。
--
-- 決めごと（画面のコードを信用しなくても DB が守ること）
--   ・承認した計画は書き換えられない。変えるときは新しい版を作る（記録は当時の版に結び付く）
--   ・記録した人・直した人は auth.uid() から自動で入る（画面から偽れない）
--   ・記録を直すときは理由が要る。直す前と後は haccp_revisions に全部残る
--   ・最初に「問題あり」だった事実（first_result / first_ng_at）は直しても消えない
--   ・過去日の追記は entered_late で分かる。実施日時(measured_at)と入力日時(recorded_at)は別の列
--   ・記録は消せない（削除の方針を置かない）。自動で消す仕組みも作らない（最低1年は残す前提）
--   ・閲覧・入力は haccp.record、確認・改善対応・計画の下書きは haccp.manage、
--     計画の承認は haccp.approve（オーナー）
--
-- 何も自動で作らない：計画の下書き・設備・メニュー・実績は、この移行では1行も入れない。

-- ── 権限 ───────────────────────────────────────────────
insert into permissions (code, label) values
  ('haccp.record',  '衛生管理の記録（入力・閲覧）'),
  ('haccp.manage',  '衛生管理の確認・改善対応・計画の下書き'),
  ('haccp.approve', '衛生管理計画の承認')
on conflict (code) do nothing;

insert into role_permissions (role, permission)
select v.r::user_role, v.p
from (values
  ('owner',   'haccp.record'), ('owner',   'haccp.manage'), ('owner', 'haccp.approve'),
  ('manager', 'haccp.record'), ('manager', 'haccp.manage'),
  ('staff',   'haccp.record')
) v(r, p)
on conflict do nothing;

-- ── 営業日（日本時間・朝4時までは前日）────────────────────────
create or replace function public.haccp_biz_today()
returns date language sql stable as $$
  select ((now() at time zone 'Asia/Tokyo') - interval '4 hours')::date
$$;

-- ── 計画（版ごとに1行）──────────────────────────────────────
create table if not exists haccp_plans (
  id              uuid primary key default gen_random_uuid(),
  version         integer not null unique check (version > 0),
  status          text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),
  store_name      text,
  hygiene_manager text,            -- 食品衛生責任者
  author_name     text,            -- 計画作成者
  effective_from  date,            -- 適用開始日
  change_reason   text,            -- この版で何を変えたか
  content         jsonb not null default '{}'::jsonb,  -- 一般衛生管理・設備・メニュー別の重要管理
  created_by      uuid references profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_by      uuid references profiles(id),
  updated_at      timestamptz not null default now(),
  approved_by     uuid references profiles(id),
  approved_at     timestamptz,
  superseded_at   timestamptz
);
-- 下書きは同時に1つだけ
create unique index if not exists haccp_plans_one_draft on haccp_plans ((true)) where status = 'draft';

create or replace function public.haccp_plans_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  frozen_old jsonb;
  frozen_new jsonb;
  prev_from  date;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception '承認した計画は削除できません。';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception '計画は下書きとして作り、承認の手順を通してください。';
    end if;
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.updated_by := new.created_by;
    new.approved_by := null; new.approved_at := null; new.superseded_at := null;
    return new;
  end if;

  -- UPDATE
  if old.status in ('approved', 'superseded') then
    -- 承認済みの版は、新しい版に置き換わった印を付ける以外は変えられない
    frozen_old := to_jsonb(old) - 'status' - 'superseded_at' - 'updated_at' - 'updated_by';
    frozen_new := to_jsonb(new) - 'status' - 'superseded_at' - 'updated_at' - 'updated_by';
    if frozen_old <> frozen_new or not (old.status = 'approved' and new.status = 'superseded') then
      raise exception '承認した計画は書き換えられません。変更するときは新しい版（下書き）を作ってください。';
    end if;
    return new;
  end if;

  -- old.status = 'draft'
  new.version := old.version;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();

  if new.status = 'superseded' then
    raise exception '下書きを「置き換え済み」にはできません。';
  end if;

  if new.status = 'approved' then
    if auth.uid() is not null and not public.has_permission('haccp.approve') then
      raise exception '計画の承認はオーナーだけができます。';
    end if;
    if coalesce(btrim(new.store_name), '') = '' or coalesce(btrim(new.hygiene_manager), '') = ''
       or coalesce(btrim(new.author_name), '') = '' or new.effective_from is null then
      raise exception '店舗名・食品衛生責任者・計画作成者・適用開始日が入っていない計画は承認できません。';
    end if;
    if jsonb_array_length(coalesce(new.content -> 'equipment', '[]'::jsonb)) = 0 then
      raise exception '冷蔵庫・冷凍庫が1台も登録されていない計画は承認できません。';
    end if;
    select max(effective_from) into prev_from
      from haccp_plans where status in ('approved', 'superseded') and id <> new.id;
    if prev_from is not null and new.effective_from < prev_from then
      raise exception '適用開始日は、前の版の適用開始日（%）以降にしてください。', prev_from;
    end if;
    new.approved_by := coalesce(auth.uid(), new.approved_by);
    new.approved_at := now();
  else
    new.approved_by := null;
    new.approved_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists haccp_plans_guard on haccp_plans;
create trigger haccp_plans_guard
  before insert or update or delete on haccp_plans
  for each row execute function haccp_plans_guard();

-- 新しい版を承認したら、それまでの版は「置き換え済み」にする（過去の記録はその版のまま）
create or replace function public.haccp_plans_supersede()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status = 'draft' then
    update haccp_plans set status = 'superseded', superseded_at = now()
     where status = 'approved' and id <> new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists haccp_plans_supersede on haccp_plans;
create trigger haccp_plans_supersede
  after update on haccp_plans
  for each row execute function haccp_plans_supersede();

-- ── 周知（いつ・どうやって伝えたか）と、スタッフ本人の「読みました」──────
create table if not exists haccp_plan_notices (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references haccp_plans(id),
  noticed_on  date not null,
  method      text not null,          -- 朝礼で読み合わせ・LINEで共有 など
  note        text,
  recorded_by uuid references profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

create table if not exists haccp_plan_acks (
  plan_id    uuid not null references haccp_plans(id),
  profile_id uuid not null references profiles(id) default auth.uid(),
  acked_at   timestamptz not null default now(),
  primary key (plan_id, profile_id)
);

-- ── 修正の履歴（記録・仕込み・異常対応・振り返り）────────────────
create table if not exists haccp_revisions (
  id         bigserial primary key,
  table_name text not null,
  row_id     uuid not null,
  revision   integer,
  before     jsonb,
  after      jsonb,
  reason     text,
  changed_by uuid references profiles(id),
  changed_at timestamptz not null default now()
);
create index if not exists haccp_revisions_row_idx on haccp_revisions (table_name, row_id, id);

create or replace function public.haccp_log_revision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into haccp_revisions (table_name, row_id, revision, before, after, reason, changed_by)
  values (
    tg_table_name, new.id,
    case when tg_table_name in ('haccp_checks', 'haccp_batches') then (to_jsonb(new) ->> 'revision')::int end,
    to_jsonb(old), to_jsonb(new),
    to_jsonb(new) ->> 'edit_reason',
    auth.uid()
  );
  return new;
end;
$$;

-- 承認済みの計画を指しているか（下書きの計画に記録を結び付けない）
create or replace function public.haccp_plan_is_live(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from haccp_plans where id = p and status in ('approved', 'superseded'))
$$;

-- ── 毎日のチェック（一般衛生管理・設備の温度・重要管理の日次確認）──────
create table if not exists haccp_checks (
  id           uuid primary key default gen_random_uuid(),
  biz_date     date not null,
  check_key    text not null,       -- gen:<項目>:<時間帯> / eq:<設備>:<時間帯> / cc:<グループ>:<時間帯>
  plan_id      uuid not null references haccp_plans(id),
  result       text not null check (result in ('ok', 'ng', 'na')),
  temp_c       numeric(5, 1),
  criteria     jsonb,               -- 判定に使った基準（その時点の計画から写す）
  measured_at  timestamptz,         -- 実施・測定した日時
  note         text,                -- 問題の内容・該当なしの理由など
  action       text,                -- その場で行った対応
  first_result text not null,       -- 最初に記録した結果（直しても変わらない）
  recorded_by  uuid not null references profiles(id),
  recorded_at  timestamptz not null default now(),
  entered_late boolean not null default false,
  updated_by   uuid references profiles(id),
  updated_at   timestamptz,
  edit_reason  text,
  revision     integer not null default 1,
  unique (biz_date, check_key)
);
create index if not exists haccp_checks_date_idx on haccp_checks (biz_date);

create or replace function public.haccp_checks_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.biz_date > haccp_biz_today() then
      raise exception '未来の日付には記録できません。';
    end if;
    if not haccp_plan_is_live(new.plan_id) then
      raise exception '承認済みの計画が無い状態では記録できません。';
    end if;
    new.recorded_by  := coalesce(auth.uid(), new.recorded_by);
    new.recorded_at  := now();
    new.entered_late := new.biz_date < haccp_biz_today();
    new.first_result := new.result;
    new.revision     := 1;
    new.updated_by := null; new.updated_at := null; new.edit_reason := null;
    if new.entered_late and new.measured_at is null then
      raise exception '過去の日の追記は、実施した日時を入れてください。';
    end if;
    new.measured_at := coalesce(new.measured_at, now());
  else
    if coalesce(btrim(new.edit_reason), '') = '' then
      raise exception '記録を直すときは理由を入れてください。';
    end if;
    -- 変えてはいけない列
    new.biz_date := old.biz_date; new.check_key := old.check_key; new.plan_id := old.plan_id;
    new.first_result := old.first_result; new.criteria := old.criteria;
    new.recorded_by := old.recorded_by; new.recorded_at := old.recorded_at;
    new.entered_late := old.entered_late;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.updated_at := now();
    new.revision := old.revision + 1;
  end if;
  if new.result = 'ng' and coalesce(btrim(new.note), '') = '' and coalesce(btrim(new.action), '') = '' then
    raise exception '「問題あり」のときは、問題の内容か対応を書いてください。';
  end if;
  return new;
end;
$$;

drop trigger if exists haccp_checks_guard on haccp_checks;
create trigger haccp_checks_guard
  before insert or update on haccp_checks
  for each row execute function haccp_checks_guard();
drop trigger if exists haccp_checks_rev on haccp_checks;
create trigger haccp_checks_rev
  after update on haccp_checks
  for each row execute function haccp_log_revision();

-- ── 重要管理の仕込み・調理記録（料理・仕込み単位）──────────────────
create table if not exists haccp_batches (
  id            uuid primary key default gen_random_uuid(),
  biz_date      date not null,
  plan_id       uuid not null references haccp_plans(id),
  menu_id       text not null,        -- 計画の中のメニューのID
  item_name     text not null,        -- 品名（仕込みの単位）
  cc_group      text not null check (cc_group in ('g1', 'g2', 'g3')),
  variant       text not null,
  cooked_at     timestamptz,          -- 調理日時
  vals          jsonb not null default '{}'::jsonb,  -- 加熱・冷却・冷蔵・高温保管・再加熱の実測
  criteria      jsonb,                -- 判定に使った基準（その時点の計画から写す）
  judgement     text not null default 'pending' check (judgement in ('ok', 'ng', 'pending')),
  first_ng_at   timestamptz,          -- 初めて基準外になった日時（直しても消えない）
  storage_place text,
  use_by        timestamptz,          -- 店舗で決めた使用期限
  performer_id  uuid references profiles(id),
  note          text,
  recorded_by   uuid not null references profiles(id),
  recorded_at   timestamptz not null default now(),
  entered_late  boolean not null default false,
  updated_by    uuid references profiles(id),
  updated_at    timestamptz,
  edit_reason   text,
  revision      integer not null default 1
);
create index if not exists haccp_batches_date_idx on haccp_batches (biz_date);

create or replace function public.haccp_batches_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.biz_date > haccp_biz_today() then
      raise exception '未来の日付には記録できません。';
    end if;
    if not haccp_plan_is_live(new.plan_id) then
      raise exception '承認済みの計画が無い状態では記録できません。';
    end if;
    new.recorded_by  := coalesce(auth.uid(), new.recorded_by);
    new.recorded_at  := now();
    new.entered_late := new.biz_date < haccp_biz_today();
    new.performer_id := coalesce(new.performer_id, new.recorded_by);
    new.revision     := 1;
    new.updated_by := null; new.updated_at := null; new.edit_reason := null;
    new.first_ng_at  := case when new.judgement = 'ng' then now() end;
  else
    -- 冷却の終わりなど「まだ空だった欄を埋める」のは理由なしでよい。
    -- 一度入れた値を変える・消すときは理由が要る
    if not (old.vals <@ new.vals)
       or (old.item_name is distinct from new.item_name)
       or (old.cooked_at is not null and old.cooked_at is distinct from new.cooked_at)
       or (old.storage_place is not null and old.storage_place is distinct from new.storage_place)
       or (old.use_by is not null and old.use_by is distinct from new.use_by)
       or (old.performer_id is distinct from new.performer_id) then
      if coalesce(btrim(new.edit_reason), '') = '' or new.edit_reason is not distinct from old.edit_reason then
        raise exception '入れた値を直すときは理由を入れてください。';
      end if;
    end if;
    new.biz_date := old.biz_date; new.plan_id := old.plan_id; new.menu_id := old.menu_id;
    new.cc_group := old.cc_group; new.variant := old.variant; new.criteria := old.criteria;
    new.recorded_by := old.recorded_by; new.recorded_at := old.recorded_at;
    new.entered_late := old.entered_late;
    new.first_ng_at := coalesce(old.first_ng_at, case when new.judgement = 'ng' then now() end);
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.updated_at := now();
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists haccp_batches_guard on haccp_batches;
create trigger haccp_batches_guard
  before insert or update on haccp_batches
  for each row execute function haccp_batches_guard();
drop trigger if exists haccp_batches_rev on haccp_batches;
create trigger haccp_batches_rev
  after update on haccp_batches
  for each row execute function haccp_log_revision();

-- ── 異常と改善対応 ────────────────────────────────────────
create table if not exists haccp_incidents (
  id             uuid primary key default gen_random_uuid(),
  biz_date       date not null,
  occurred_at    timestamptz not null,
  plan_id        uuid references haccp_plans(id),
  source         text not null default 'manual' check (source in ('check', 'batch', 'manual')),
  check_id       uuid references haccp_checks(id),
  batch_id       uuid references haccp_batches(id),
  category       text not null default 'other'
                   check (category in ('temp', 'heating', 'cooling', 'pest', 'hygiene', 'health', 'receiving', 'other')),
  target         text not null,       -- 対象の設備・料理・仕込み
  problem        text not null,       -- 問題の内容
  action         text,                -- 実施した対応
  dispositions   text[] not null default '{}',  -- 提供中止・廃棄・責任者へ確認 など
  recheck_at     timestamptz,
  recheck_result text check (recheck_result in ('ok', 'ng')),
  recheck_note   text,
  handler_id     uuid references profiles(id),  -- 担当者
  due_on         date,                          -- 対応期限
  prevention     text,                          -- 再発防止・改善事項
  status         text not null default 'open' check (status in ('open', 'done')),
  confirmer_id   uuid references profiles(id),  -- 確認者（対応済みにした人）
  confirmed_at   timestamptz,
  created_by     uuid not null references profiles(id),
  created_at     timestamptz not null default now(),
  entered_late   boolean not null default false,
  updated_by     uuid references profiles(id),
  updated_at     timestamptz
);
create index if not exists haccp_incidents_date_idx on haccp_incidents (biz_date);
create index if not exists haccp_incidents_open_idx on haccp_incidents (status) where status = 'open';

create or replace function public.haccp_incidents_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by   := coalesce(auth.uid(), new.created_by);
    new.created_at   := now();
    new.entered_late := new.biz_date < haccp_biz_today();
    new.handler_id   := coalesce(new.handler_id, new.created_by);
    new.updated_by := null; new.updated_at := null;
    if new.status = 'done' then
      raise exception '異常の記録は「対応中」から始めてください。対応済みにするのは店長・オーナーの確認です。';
    end if;
  else
    new.created_by := old.created_by; new.created_at := old.created_at;
    new.entered_late := old.entered_late;
    new.biz_date := old.biz_date; new.source := old.source;
    new.check_id := old.check_id; new.batch_id := old.batch_id;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.updated_at := now();
    if new.status = 'done' and old.status <> 'done' then
      if auth.uid() is not null and not public.has_permission('haccp.manage') then
        raise exception '対応済みにできるのは店長・オーナーです。';
      end if;
      if coalesce(btrim(new.action), '') = '' then
        raise exception '実施した対応を書いてから対応済みにしてください。';
      end if;
      if new.recheck_result is null and cardinality(new.dispositions) = 0 then
        raise exception '再確認の結果か、取った処置（廃棄・提供中止など）を入れてから対応済みにしてください。';
      end if;
      if new.recheck_result = 'ng' then
        raise exception '再確認の結果が「問題あり」のままでは対応済みにできません。';
      end if;
      new.confirmer_id := coalesce(auth.uid(), new.confirmer_id);
      new.confirmed_at := now();
    elsif new.status = 'open' then
      if old.status = 'done' and auth.uid() is not null and not public.has_permission('haccp.manage') then
        raise exception '対応済みを戻せるのは店長・オーナーです。';
      end if;
      new.confirmer_id := null; new.confirmed_at := null;
    else
      new.confirmer_id := old.confirmer_id; new.confirmed_at := old.confirmed_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists haccp_incidents_guard on haccp_incidents;
create trigger haccp_incidents_guard
  before insert or update on haccp_incidents
  for each row execute function haccp_incidents_guard();
drop trigger if exists haccp_incidents_rev on haccp_incidents;
create trigger haccp_incidents_rev
  after update on haccp_incidents
  for each row execute function haccp_log_revision();

-- ── 日締め（その営業日の記録を閉じる。深夜0時を回っても前の営業日を閉じられる）──
create table if not exists haccp_day_closes (
  biz_date      date primary key,
  plan_id       uuid references haccp_plans(id),
  missing_count integer not null default 0,   -- 閉じた時点の未記録の数
  note          text,
  closed_by     uuid not null references profiles(id),
  closed_at     timestamptz not null default now(),
  entered_late  boolean not null default false
);

create or replace function public.haccp_day_closes_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.biz_date > haccp_biz_today() then
    raise exception '未来の日は締められません。';
  end if;
  new.closed_by := coalesce(auth.uid(), new.closed_by);
  new.closed_at := now();
  -- 営業日の翌日の朝4時を過ぎてから締めたら追記扱い
  new.entered_late := new.biz_date < haccp_biz_today();
  return new;
end;
$$;

drop trigger if exists haccp_day_closes_guard on haccp_day_closes;
create trigger haccp_day_closes_guard
  before insert on haccp_day_closes
  for each row execute function haccp_day_closes_guard();

-- ── 週の確認・月の振り返り ───────────────────────────────────
create table if not exists haccp_reviews (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('week', 'month')),
  period_start       date not null,
  period_end         date not null,
  summary            jsonb not null default '{}'::jsonb,  -- 確認した時点の集計（未記録・問題・対応中の数）
  comment            text,
  repeat_issues      text,          -- 繰り返している問題
  improvements       jsonb not null default '[]'::jsonb,  -- [{task, owner, due, done}]
  plan_review_needed boolean not null default false,
  reviewer_id        uuid not null references profiles(id),
  reviewed_at        timestamptz not null default now(),
  updated_by         uuid references profiles(id),
  updated_at         timestamptz,
  unique (kind, period_start),
  check (period_end >= period_start)
);

create or replace function public.haccp_reviews_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.reviewer_id := coalesce(auth.uid(), new.reviewer_id);
    new.reviewed_at := now();
    new.updated_by := null; new.updated_at := null;
  else
    new.kind := old.kind; new.period_start := old.period_start; new.period_end := old.period_end;
    new.reviewer_id := old.reviewer_id; new.reviewed_at := old.reviewed_at;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists haccp_reviews_guard on haccp_reviews;
create trigger haccp_reviews_guard
  before insert or update on haccp_reviews
  for each row execute function haccp_reviews_guard();
drop trigger if exists haccp_reviews_rev on haccp_reviews;
create trigger haccp_reviews_rev
  after update on haccp_reviews
  for each row execute function haccp_log_revision();

-- ── 暦用：日ごとに記録済みのチェック一覧 ──────────────────────────
create or replace view haccp_day_keys with (security_invoker = true) as
  select biz_date,
         array_agg(check_key order by check_key) as keys,
         count(*) filter (where first_result = 'ng')::int as ng_count
    from haccp_checks
   group by biz_date;

-- ── RLS ───────────────────────────────────────────────────
alter table haccp_plans        enable row level security;
alter table haccp_plan_notices enable row level security;
alter table haccp_plan_acks    enable row level security;
alter table haccp_revisions    enable row level security;
alter table haccp_checks       enable row level security;
alter table haccp_batches      enable row level security;
alter table haccp_incidents    enable row level security;
alter table haccp_day_closes   enable row level security;
alter table haccp_reviews      enable row level security;

revoke all on haccp_plans, haccp_plan_notices, haccp_plan_acks, haccp_revisions, haccp_checks,
  haccp_batches, haccp_incidents, haccp_day_closes, haccp_reviews, haccp_day_keys from anon;
grant select, insert, update, delete on haccp_plans to authenticated;
grant select, insert on haccp_plan_notices, haccp_plan_acks, haccp_day_closes to authenticated;
grant select on haccp_revisions, haccp_day_keys to authenticated;
grant select, insert, update on haccp_checks, haccp_batches, haccp_incidents, haccp_reviews to authenticated;

-- 計画：読むのは記録する人全員。下書きを作る・直す・捨てるのは店長・オーナー。
-- 承認（draft→approved）はトリガでオーナーに絞る
drop policy if exists haccp_plans_select on haccp_plans;
create policy haccp_plans_select on haccp_plans for select to authenticated
  using (has_permission('haccp.record'));
drop policy if exists haccp_plans_insert on haccp_plans;
create policy haccp_plans_insert on haccp_plans for insert to authenticated
  with check (has_permission('haccp.manage') and status = 'draft');
drop policy if exists haccp_plans_update on haccp_plans;
create policy haccp_plans_update on haccp_plans for update to authenticated
  using (has_permission('haccp.manage')) with check (has_permission('haccp.manage'));
drop policy if exists haccp_plans_delete on haccp_plans;
create policy haccp_plans_delete on haccp_plans for delete to authenticated
  using (has_permission('haccp.manage') and status = 'draft');

drop policy if exists haccp_notices_select on haccp_plan_notices;
create policy haccp_notices_select on haccp_plan_notices for select to authenticated
  using (has_permission('haccp.record'));
drop policy if exists haccp_notices_insert on haccp_plan_notices;
create policy haccp_notices_insert on haccp_plan_notices for insert to authenticated
  with check (has_permission('haccp.manage') and recorded_by = auth.uid());

-- 「読みました」は本人の分だけ押せる
drop policy if exists haccp_acks_select on haccp_plan_acks;
create policy haccp_acks_select on haccp_plan_acks for select to authenticated
  using (has_permission('haccp.record'));
drop policy if exists haccp_acks_insert on haccp_plan_acks;
create policy haccp_acks_insert on haccp_plan_acks for insert to authenticated
  with check (has_permission('haccp.record') and profile_id = auth.uid());

drop policy if exists haccp_revisions_select on haccp_revisions;
create policy haccp_revisions_select on haccp_revisions for select to authenticated
  using (has_permission('haccp.record'));

-- 記録：スタッフは入力でき、自分の記録は理由を付けて直せる。人の記録を直すのは店長・オーナー
drop policy if exists haccp_checks_select on haccp_checks;
create policy haccp_checks_select on haccp_checks for select to authenticated
  using (has_permission('haccp.record'));
drop policy if exists haccp_checks_insert on haccp_checks;
create policy haccp_checks_insert on haccp_checks for insert to authenticated
  with check (has_permission('haccp.record'));
drop policy if exists haccp_checks_update on haccp_checks;
create policy haccp_checks_update on haccp_checks for update to authenticated
  using (has_permission('haccp.manage') or (has_permission('haccp.record') and recorded_by = auth.uid()))
  with check (has_permission('haccp.record'));

drop policy if exists haccp_batches_select on haccp_batches;
create policy haccp_batches_select on haccp_batches for select to authenticated
  using (has_permission('haccp.record'));
drop policy if exists haccp_batches_insert on haccp_batches;
create policy haccp_batches_insert on haccp_batches for insert to authenticated
  with check (has_permission('haccp.record'));
-- 冷却の終わりは別の人が測ることがあるので、記録する人なら誰でも続きを入れられる
-- （誰がいつ何を変えたかは haccp_revisions に残る）
drop policy if exists haccp_batches_update on haccp_batches;
create policy haccp_batches_update on haccp_batches for update to authenticated
  using (has_permission('haccp.record')) with check (has_permission('haccp.record'));

drop policy if exists haccp_incidents_select on haccp_incidents;
create policy haccp_incidents_select on haccp_incidents for select to authenticated
  using (has_permission('haccp.record'));
drop policy if exists haccp_incidents_insert on haccp_incidents;
create policy haccp_incidents_insert on haccp_incidents for insert to authenticated
  with check (has_permission('haccp.record'));
drop policy if exists haccp_incidents_update on haccp_incidents;
create policy haccp_incidents_update on haccp_incidents for update to authenticated
  using (has_permission('haccp.record')) with check (has_permission('haccp.record'));

drop policy if exists haccp_day_closes_select on haccp_day_closes;
create policy haccp_day_closes_select on haccp_day_closes for select to authenticated
  using (has_permission('haccp.record'));
drop policy if exists haccp_day_closes_insert on haccp_day_closes;
create policy haccp_day_closes_insert on haccp_day_closes for insert to authenticated
  with check (has_permission('haccp.record'));

drop policy if exists haccp_reviews_select on haccp_reviews;
create policy haccp_reviews_select on haccp_reviews for select to authenticated
  using (has_permission('haccp.record'));
drop policy if exists haccp_reviews_insert on haccp_reviews;
create policy haccp_reviews_insert on haccp_reviews for insert to authenticated
  with check (has_permission('haccp.manage'));
drop policy if exists haccp_reviews_update on haccp_reviews;
create policy haccp_reviews_update on haccp_reviews for update to authenticated
  using (has_permission('haccp.manage')) with check (has_permission('haccp.manage'));
