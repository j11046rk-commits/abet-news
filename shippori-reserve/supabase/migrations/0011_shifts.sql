-- 0011 シフト（その日に誰が入っているか）
-- 店主フィードバック（2026-08-08）：既存アプリの「バイトのシフトも一目で見れる」を引き継ぐ。
-- 暦（月ビュー）と日別画面に、その日のシフトを名前チップで出すための最小のテーブル。

create table if not exists shifts (
  biz_date   date not null,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  primary key (biz_date, profile_id)
);

create index if not exists shifts_date_idx on shifts (biz_date);

-- 確定シフトを組めるのは店長とオーナーだけ（スタッフは希望を出す側。0012参照）
insert into permissions (code, label) values ('shift.write', '確定シフトの編集')
on conflict (code) do nothing;

insert into role_permissions (role, permission)
select unnest(array['owner','manager']::user_role[]), 'shift.write'
on conflict do nothing;

alter table shifts enable row level security;
revoke all on shifts from anon;
grant select, insert, delete on shifts to authenticated;
-- update は無い。シフトは「入っている／いない」の2状態しかないので、行の有無だけで持つ。

drop policy if exists shifts_select on shifts;
create policy shifts_select on shifts
  for select to authenticated using (is_active_user());

drop policy if exists shifts_write on shifts;
create policy shifts_write on shifts
  for all to authenticated
  using (has_permission('shift.write'))
  with check (has_permission('shift.write'));

drop trigger if exists shifts_audit on shifts;
create trigger shifts_audit
  after insert or delete on shifts
  for each row execute function write_audit('biz_date');
