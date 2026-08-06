-- The Oldmans — 0015 立替を精算したら台帳に自動記帳する
--
-- 立替そのものは施設の収支を動かさない。動くのは精算したとき — 施設の金が
-- 立て替えた人へ出ていく瞬間である。これまではチェックを入れても台帳には
-- 何も起きず、手で記帳し直す必要があった。二度手間だし、忘れれば支出が抜ける。
--
-- セッションのレーキ行（0004）と同じ考え方で、トリガに任せる。
-- チェックを外したら記帳も消える — 押し間違いを戻せるようにするため。

alter table ledger_entries
  add column if not exists advance_id uuid references advances(id) on delete set null;

create unique index if not exists ledger_entries_advance_key
  on ledger_entries (advance_id)
  where advance_id is not null;

comment on column ledger_entries.advance_id is
  '立替の精算から自動起票された行。立替側のチェックを外すと消える。';

-- security definer：立替を精算するのは6人の誰でもよく、その人の権限で
-- 台帳へ書けるかどうかとは切り離したい（トリガの意図を明示する）。
create or replace function public.sync_advance_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 精算した → 支出として起票
  if new.settled_at is not null and (old.settled_at is null or tg_op = 'INSERT') then
    insert into ledger_entries
      (entry_date, direction, category, amount_yen, memo, advance_id, created_by)
    values (
      (new.settled_at at time zone 'Asia/Tokyo')::date,
      'expense',
      'advance_settle',
      new.amount_yen,
      new.title,
      new.id,
      new.profile_id      -- 誰への支払いかが台帳から辿れるようにする
    )
    on conflict (advance_id) where advance_id is not null do update
      set entry_date = excluded.entry_date,
          amount_yen = excluded.amount_yen,
          memo = excluded.memo;

  -- チェックを外した → 起票を取り消す
  elsif new.settled_at is null and old.settled_at is not null then
    delete from ledger_entries where advance_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists advances_sync_ledger on advances;

create trigger advances_sync_ledger
  after insert or update of settled_at, amount_yen, title on advances
  for each row execute function public.sync_advance_ledger();

-- 立替の行そのものを消したら、起票も一緒に消す。
create or replace function public.drop_advance_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from ledger_entries where advance_id = old.id;
  return old;
end;
$$;

drop trigger if exists advances_drop_ledger on advances;

create trigger advances_drop_ledger
  before delete on advances
  for each row execute function public.drop_advance_ledger();

-- 自動起票された行は台帳から直接いじらせない（レーキ行・固定費と同じ扱い）。
drop policy if exists ledger_update on ledger_entries;
drop policy if exists ledger_delete on ledger_entries;

create policy ledger_update on ledger_entries
  for update to authenticated
  using (
    public.is_active_user()
    and session_id is null and fixed_cost_id is null and advance_id is null
  )
  with check (
    public.is_active_user()
    and session_id is null and fixed_cost_id is null and advance_id is null
  );

create policy ledger_delete on ledger_entries
  for delete to authenticated
  using (
    public.is_active_user()
    and session_id is null and fixed_cost_id is null and advance_id is null
  );

-- 既に精算済みの立替があれば、いまのうちに起票しておく。
update advances set settled_at = settled_at where settled_at is not null;
