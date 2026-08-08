-- 0012 希望シフト（店主フィードバック 2026-08-08）
--
-- 店長以外のスタッフは、毎月25日までに「次の月に入れる日」を出す。
-- 店長（とオーナー）はそれを見ながら確定シフト（shifts）を組む。
-- 希望と確定を別のテーブルに分けるのは、「出した希望」と「決まった結果」を
-- 混ぜないため。希望は本人の行しか書けない。

create table if not exists shift_requests (
  biz_date   date not null,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (biz_date, profile_id)
);

create index if not exists shift_requests_date_idx on shift_requests (biz_date);

insert into permissions (code, label) values ('shiftrequest.write', '希望シフトの提出')
on conflict (code) do nothing;

-- 提出できるのは一般スタッフのみ（店長は組む側、オーナーはシフトに入らない）
insert into role_permissions (role, permission)
values ('staff', 'shiftrequest.write')
on conflict do nothing;

alter table shift_requests enable row level security;
revoke all on shift_requests from anon;
grant select, insert, delete on shift_requests to authenticated;

drop policy if exists shift_requests_select on shift_requests;
create policy shift_requests_select on shift_requests
  for select to authenticated using (is_active_user());

-- ★ 自分の行しか書けない。他人の希望を出したり消したりはDBが拒否する。
drop policy if exists shift_requests_write on shift_requests;
create policy shift_requests_write on shift_requests
  for all to authenticated
  using (profile_id = auth.uid() and has_permission('shiftrequest.write'))
  with check (profile_id = auth.uid() and has_permission('shiftrequest.write'));

drop trigger if exists shift_requests_audit on shift_requests;
create trigger shift_requests_audit
  after insert or delete on shift_requests
  for each row execute function write_audit('biz_date');
