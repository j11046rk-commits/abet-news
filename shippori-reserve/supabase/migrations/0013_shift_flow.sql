-- 0013 シフトの提出と確定（店主フィードバック 2026-08-08 その8）
--
-- 「出した・出していない」「確定した・していない」を月単位で持つ。
-- - shift_request_submissions：スタッフが希望を「提出」した記録（誰がいつ）
-- - shift_publications：店長がその月のシフトを「確定」した記録
-- 確定されるまで、shifts の行があっても暦には表示しない。

create table if not exists shift_request_submissions (
  ym           text not null check (ym ~ '^[0-9]{4}-[0-9]{2}$'),
  profile_id   uuid not null references profiles(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  primary key (ym, profile_id)
);

alter table shift_request_submissions enable row level security;
revoke all on shift_request_submissions from anon;
-- 読み取りのみ。提出記録は 0014 の関数だけが書く（提出時刻の偽造を防ぐ）。
grant select on shift_request_submissions to authenticated;

drop policy if exists shift_request_submissions_select on shift_request_submissions;
create policy shift_request_submissions_select on shift_request_submissions
  for select to authenticated using (is_active_user());

drop policy if exists shift_request_submissions_write on shift_request_submissions;

create table if not exists shift_publications (
  ym           text primary key check (ym ~ '^[0-9]{4}-[0-9]{2}$'),
  published_at timestamptz not null default now(),
  published_by uuid references profiles(id)
);

alter table shift_publications enable row level security;
revoke all on shift_publications from anon;
-- 読み取りのみ。確定の記録は 0014 の関数だけが書く（published_by は必ず本人になる）。
grant select on shift_publications to authenticated;

drop policy if exists shift_publications_select on shift_publications;
create policy shift_publications_select on shift_publications
  for select to authenticated using (is_active_user());

drop policy if exists shift_publications_write on shift_publications;
