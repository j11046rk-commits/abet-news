-- The Oldmans — 0004 セッション → 台帳の自動起票
--
-- セッションを保存すると ledger_entries に income / rake の行が自動で起票される。
-- 同じ数字を二度入力させないための仕組みなので、アプリ側ではなく DB 側に置く。
-- security definer にしてあるため、台帳への直接 insert 権を持たない member が
-- セッションを記録した場合でも起票できる。

create or replace function public.sync_session_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date;
begin
  if tg_op = 'DELETE' then
    delete from ledger_entries
     where session_id = old.id and category = 'rake';
    return old;
  end if;

  v_date := (new.started_at at time zone 'Asia/Tokyo')::date;

  if new.rake_yen > 0 then
    insert into ledger_entries (entry_date, direction, category, amount_yen, memo, session_id, created_by)
    values (v_date, 'income', 'rake', new.rake_yen, null, new.id, new.created_by)
    on conflict (session_id) where (session_id is not null and category = 'rake')
    do update set
      entry_date = excluded.entry_date,
      amount_yen = excluded.amount_yen;
  else
    -- レーキ 0 のセッション（練習卓など）は台帳に行を残さない
    delete from ledger_entries
     where session_id = new.id and category = 'rake';
  end if;

  return new;
end;
$$;

create trigger sessions_sync_ledger_ins
  after insert on sessions
  for each row execute function public.sync_session_ledger();

create trigger sessions_sync_ledger_upd
  after update of started_at, rake_yen on sessions
  for each row execute function public.sync_session_ledger();

create trigger sessions_sync_ledger_del
  before delete on sessions
  for each row execute function public.sync_session_ledger();
