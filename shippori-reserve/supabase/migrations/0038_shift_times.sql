-- 0038 シフトに時間を持たせる（店主指示 2026-08-17）
--
-- これまでシフトは「その日に入っているか／いないか」だけだった。
-- 実際には人ごとに基本の出勤時間が決まっていて、そこが画面から抜けていた。
--
--   金本 19:30〜LAST ／ 安藤 18:00〜20:00（日月休み）
--   白石 18:30〜LAST ／ 高木 19:00〜LAST ／ 安井 18:30〜21:00
--
-- ★提出の簡単さは変えない（店主指示）。
--   ◯を押した日には基本の時間が自動で入り、違う日だけ直す。
--   毎日時間を選ばせると、いまの「タップするだけ」の速さが失われる。
--
-- ★LAST は「その日の閉店まで」という意味で持つ（時刻を焼き付けない）。
--   金土は25:00・それ以外は0:00 だが、これは営業時間そのもの。
--   25:00 と書き込んでしまうと、営業時間を変えた日にシフトだけ古い時刻で残る。
--   end_min = null を「LAST」とし、表示するときにその日の閉店時刻を当てる。

-- ── 1) 人ごとの基本の時間 ──────────────────────────────
-- default_start_min が null ＝ 時間の概念を持たない人（店長・オーナー）。
-- default_end_min が null ＝ LAST。
alter table profiles
  add column if not exists default_start_min int,
  add column if not exists default_end_min   int,
  add column if not exists off_weekdays      smallint[] not null default '{}';

comment on column profiles.default_start_min is
  '基本の出勤時刻（営業日0:00からの分）。null＝時間を持たない人（店長・オーナー）';
comment on column profiles.default_end_min is
  '基本の退勤時刻。null＝LAST（その日の閉店まで）';
comment on column profiles.off_weekdays is
  '普段お休みの曜日（0=日 … 6=土）。提出画面では×のままにしておくための目印';

-- ── 2) 日ごとの時間（希望・確定の両方）────────────────────
-- start_min が null ＝ その人の基本をそのまま使う（昔の行もここに入る）。
-- start_min が入っていれば、end_min の null は LAST を意味する。
-- 2列を必ず組で読むことで、「未設定」と「LAST」を取り違えない。
alter table shift_requests
  add column if not exists start_min int,
  add column if not exists end_min   int;
alter table shifts
  add column if not exists start_min int,
  add column if not exists end_min   int;

comment on column shift_requests.start_min is
  '出勤時刻。null＝本人の基本を使う（end_min も基本に従う）';
comment on column shift_requests.end_min is
  '退勤時刻。start_min が入っているときの null は LAST（その日の閉店まで）';
comment on column shifts.start_min is
  '出勤時刻。null＝本人の基本を使う（end_min も基本に従う）';
comment on column shifts.end_min is
  '退勤時刻。start_min が入っているときの null は LAST（その日の閉店まで）';

-- ── 3) いまの基本の時間を入れる ────────────────────────
-- 18:00=1080 / 18:30=1110 / 19:00=1140 / 19:30=1170 / 20:00=1200 / 21:00=1260
update profiles set default_start_min = 1170, default_end_min = null  where login_id = 'kanemoto';
update profiles set default_start_min = 1080, default_end_min = 1200, off_weekdays = '{0,1}'
                                                                      where login_id = 'ando';
update profiles set default_start_min = 1110, default_end_min = null  where login_id = 'shiraishi';
update profiles set default_start_min = 1140, default_end_min = null  where login_id = 'takagi';
update profiles set default_start_min = 1110, default_end_min = 1260  where login_id = 'yasui';
-- 店長・オーナーは時間を持たない（店主指示）。念のため明示的に空にする。
update profiles set default_start_min = null, default_end_min = null
 where role in ('owner', 'manager');

-- ── 4) 希望シフトの提出（時間つき）────────────────────────
-- 旧: submit_month_requests(text, date[]) は残す（古い画面が動いている間の保険）。
-- 新: 引数名が違うので PostgREST から呼び分けられる。
create or replace function public.submit_month_requests(p_ym text, p_days jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  d_from date;
  d_to   date;
  target_ym text;
begin
  if not has_permission('shiftrequest.write') then
    raise exception '権限がありません。';
  end if;
  if p_ym !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception '月が不正です。';
  end if;

  target_ym := to_char(date_trunc('month', (now() at time zone 'Asia/Tokyo')::date) + interval '1 month', 'YYYY-MM');
  if p_ym <> target_ym then
    raise exception '希望を出せるのは来月分だけです。';
  end if;
  if extract(day from (now() at time zone 'Asia/Tokyo')) > 25 then
    raise exception '来月分の提出は毎月25日で締め切りです。変更は店長に伝えてください。';
  end if;

  d_from := (p_ym || '-01')::date;
  d_to   := (d_from + interval '1 month' - interval '1 day')::date;

  if exists (
    select 1 from jsonb_array_elements(p_days) x
    where (x->>'date')::date < d_from or (x->>'date')::date > d_to
  ) then
    raise exception '日付が不正です。';
  end if;

  -- 時刻は営業日0:00からの分。26:00（=1560）より後は受け付けない。
  if exists (
    select 1 from jsonb_array_elements(p_days) x
    where (x->>'start_min') is not null
      and ((x->>'start_min')::int < 0 or (x->>'start_min')::int > 1560)
  ) or exists (
    select 1 from jsonb_array_elements(p_days) x
    where (x->>'end_min') is not null
      and ((x->>'end_min')::int <= coalesce((x->>'start_min')::int, 0) or (x->>'end_min')::int > 1560)
  ) then
    raise exception '時間が不正です。';
  end if;

  delete from shift_requests
   where profile_id = auth.uid() and biz_date between d_from and d_to;

  insert into shift_requests (biz_date, profile_id, start_min, end_min)
  select distinct on ((x->>'date')::date)
         (x->>'date')::date, auth.uid(),
         (x->>'start_min')::int, (x->>'end_min')::int
    from jsonb_array_elements(p_days) x;

  insert into shift_request_submissions (ym, profile_id, submitted_at)
  values (p_ym, auth.uid(), now())
  on conflict (ym, profile_id) do update set submitted_at = now();
end;
$$;

-- ── 5) 確定シフト（時間つき）────────────────────────────
-- 引数の形は変えない（p_assignments の要素に start_min / end_min が増えるだけ）。
create or replace function public.confirm_month_shifts(p_ym text, p_assignments jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  d_from date;
  d_to   date;
begin
  if not has_permission('shift.write') then
    raise exception '権限がありません。';
  end if;
  if p_ym !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception '月が不正です。';
  end if;

  d_from := (p_ym || '-01')::date;
  d_to   := (d_from + interval '1 month' - interval '1 day')::date;

  if exists (
    select 1 from jsonb_array_elements(p_assignments) a
    where (a->>'date')::date < d_from or (a->>'date')::date > d_to
  ) then
    raise exception '日付が不正です。';
  end if;

  if exists (
    select 1 from (
      select distinct (a->>'profile_id')::uuid as pid from jsonb_array_elements(p_assignments) a
    ) x
    left join profiles p on p.id = x.pid
    where p.id is null or not p.is_active or p.role in ('owner', 'viewer')
  ) then
    raise exception 'シフトに入れられない人が含まれています。';
  end if;

  delete from shifts where biz_date between d_from and d_to;

  insert into shifts (biz_date, profile_id, created_by, start_min, end_min)
  select distinct on ((a->>'date')::date, (a->>'profile_id')::uuid)
         (a->>'date')::date, (a->>'profile_id')::uuid, auth.uid(),
         (a->>'start_min')::int, (a->>'end_min')::int
    from jsonb_array_elements(p_assignments) a;

  insert into shift_publications (ym, published_at, published_by)
  values (p_ym, now(), auth.uid())
  on conflict (ym) do update set published_at = now(), published_by = auth.uid();
end;
$$;

-- ── 6) 日ごとの差し替え（時間つき）──────────────────────
-- 旧: update_day_shifts(date, uuid[]) は残す。新しいほうは引数名で呼び分ける。
create or replace function public.update_day_shifts(p_date date, p_shifts jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_permission('shift.write') then
    raise exception '権限がありません。';
  end if;
  if not exists (select 1 from shift_publications where ym = to_char(p_date, 'YYYY-MM')) then
    raise exception 'この月はまだ確定していません。シフトタブから確定してください。';
  end if;
  if exists (
    select 1 from (
      select distinct (s->>'profile_id')::uuid as pid from jsonb_array_elements(p_shifts) s
    ) x
    left join profiles p on p.id = x.pid
    where p.id is null or not p.is_active or p.role in ('owner', 'viewer')
  ) then
    raise exception 'シフトに入れられない人が含まれています。';
  end if;

  delete from shifts where biz_date = p_date;

  insert into shifts (biz_date, profile_id, created_by, start_min, end_min)
  select distinct on ((s->>'profile_id')::uuid)
         p_date, (s->>'profile_id')::uuid, auth.uid(),
         (s->>'start_min')::int, (s->>'end_min')::int
    from jsonb_array_elements(p_shifts) s;
end;
$$;

revoke execute on function public.submit_month_requests(text, jsonb) from public, anon;
revoke execute on function public.confirm_month_shifts(text, jsonb)  from public, anon;
revoke execute on function public.update_day_shifts(date, jsonb)     from public, anon;
grant  execute on function public.submit_month_requests(text, jsonb) to authenticated;
grant  execute on function public.confirm_month_shifts(text, jsonb)  to authenticated;
grant  execute on function public.update_day_shifts(date, jsonb)     to authenticated;

-- 入ったことを確かめる
do $$
begin
  if (select count(*) from profiles where default_start_min is not null) < 5 then
    raise exception '基本の出勤時間が5名ぶん入っていません。login_id を確認してください。';
  end if;
  if not exists (select 1 from profiles where login_id = 'ando' and off_weekdays = '{0,1}') then
    raise exception '安藤さんの日月休みが入っていません。';
  end if;
end $$;
