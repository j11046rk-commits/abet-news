-- 0008 監査ログ
-- docs/03-database.md §3-9 に対応。
-- 誰がいつ何を書き換えたかを追えるようにする。予約には氏名と電話番号が入るため、これは必須。

create table if not exists audit_logs (
  id           bigserial primary key,
  actor        uuid references profiles(id),
  action       text not null,           -- 'reservations.update' 等
  target_table text not null,
  target_id    text,
  before       jsonb,
  after        jsonb,
  at           timestamptz not null default now()
);

create index if not exists audit_logs_at_idx     on audit_logs (at desc);
create index if not exists audit_logs_target_idx on audit_logs (target_table, target_id);

-- 主キーの列名はテーブルごとに違う（reservations は id、business_days は biz_date）ので、
-- トリガ引数で受け取る。既定は 'id'。
create or replace function public.write_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  key_col text  := coalesce(tg_argv[0], 'id');
  rec     jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into audit_logs (actor, action, target_table, target_id, before, after)
  values (
    auth.uid(),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    rec ->> key_col,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists reservations_audit on reservations;
create trigger reservations_audit
  after insert or update or delete on reservations
  for each row execute function write_audit('id');

drop trigger if exists business_days_audit on business_days;
create trigger business_days_audit
  after insert or update or delete on business_days
  for each row execute function write_audit('biz_date');

drop trigger if exists profiles_audit on profiles;
create trigger profiles_audit
  after insert or update or delete on profiles
  for each row execute function write_audit('id');
