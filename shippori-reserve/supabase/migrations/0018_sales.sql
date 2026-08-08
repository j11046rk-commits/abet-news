-- 0018 売上（日毎の目標と実績）（店主フィードバック 2026-08-08 その12）
--
-- カレンダーと売上タブに「目標◯円・実績◯円」を出すための最小のテーブル。
-- 実績はエアレジ→週次レポート（別リポジトリ）から /api/sales/ingest に
-- 送り込む前提。目標と実績の手入力は営業日の設定画面からもできる。

create table if not exists sales_daily (
  biz_date   date primary key,
  target_yen integer check (target_yen is null or target_yen >= 0),
  actual_yen integer check (actual_yen is null or actual_yen >= 0),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

insert into permissions (code, label) values ('sales.write', '売上目標・実績の入力')
on conflict (code) do nothing;

insert into role_permissions (role, permission)
select unnest(array['owner','manager']::user_role[]), 'sales.write'
on conflict do nothing;

alter table sales_daily enable row level security;
revoke all on sales_daily from anon;
-- 読み取りは全員（みんなが目標と実績を見られるように・店主指定）。
-- 書き込みは下の関数（と service role の取り込みAPI）だけが行う。
grant select on sales_daily to authenticated;

drop policy if exists sales_daily_select on sales_daily;
create policy sales_daily_select on sales_daily
  for select to authenticated using (is_active_user());

create or replace function public.set_sales_day(p_date date, p_target integer, p_actual integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_permission('sales.write') then
    raise exception '権限がありません。';
  end if;
  if p_target is not null and p_target < 0 then
    raise exception '金額が不正です。';
  end if;
  if p_actual is not null and p_actual < 0 then
    raise exception '金額が不正です。';
  end if;

  -- null は「触らない」。消したいときは 0 を入れる。
  insert into sales_daily (biz_date, target_yen, actual_yen, updated_by)
  values (p_date, p_target, p_actual, auth.uid())
  on conflict (biz_date) do update
    set target_yen = coalesce(p_target, sales_daily.target_yen),
        actual_yen = coalesce(p_actual, sales_daily.actual_yen),
        updated_by = auth.uid(),
        updated_at = now();
end;
$$;

revoke execute on function public.set_sales_day(date, integer, integer) from public, anon;
grant  execute on function public.set_sales_day(date, integer, integer) to authenticated;

drop trigger if exists sales_daily_audit on sales_daily;
create trigger sales_daily_audit
  after insert or update or delete on sales_daily
  for each row execute function write_audit('biz_date');
