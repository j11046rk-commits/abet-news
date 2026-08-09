-- 0014 シフトの保存を1トランザクションに
--
-- 「月まるごと削除→挿入→記録」をアプリから3回に分けて呼ぶと、
-- 途中で失敗したときに確定済みシフトが消えたままになる。
-- DB関数に寄せて、全部成功するか全部無かったことになるかの二択にする。
-- security definer なので、権限と締切の検査は関数の中で必ず行う
-- （PostgRESTから直接叩かれても抜け道にならない）。

-- ── 希望シフトの提出（一般スタッフ・自分の分だけ・締切つき）──
create or replace function public.submit_month_requests(p_ym text, p_dates date[])
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

  -- 対象は翌月分だけ・毎月25日締切（日本時間）
  target_ym := to_char(date_trunc('month', (now() at time zone 'Asia/Tokyo')::date) + interval '1 month', 'YYYY-MM');
  if p_ym <> target_ym then
    raise exception '希望を出せるのは来月分だけです。';
  end if;
  if extract(day from (now() at time zone 'Asia/Tokyo')) > 25 then
    raise exception '来月分の提出は毎月25日で締め切りです。変更は店長に伝えてください。';
  end if;

  d_from := (p_ym || '-01')::date;
  d_to   := (d_from + interval '1 month' - interval '1 day')::date;

  if exists (select 1 from unnest(p_dates) d where d < d_from or d > d_to) then
    raise exception '日付が不正です。';
  end if;

  delete from shift_requests
   where profile_id = auth.uid() and biz_date between d_from and d_to;

  insert into shift_requests (biz_date, profile_id)
  select distinct d, auth.uid() from unnest(p_dates) d;

  insert into shift_request_submissions (ym, profile_id, submitted_at)
  values (p_ym, auth.uid(), now())
  on conflict (ym, profile_id) do update set submitted_at = now();
end;
$$;

-- ── シフトの確定（店長・オーナー）──
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

  -- オーナー・閲覧のみ・退職者はシフトに入れられない
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

  insert into shifts (biz_date, profile_id, created_by)
  select distinct (a->>'date')::date, (a->>'profile_id')::uuid, auth.uid()
  from jsonb_array_elements(p_assignments) a;

  insert into shift_publications (ym, published_at, published_by)
  values (p_ym, now(), auth.uid())
  on conflict (ym) do update set published_at = now(), published_by = auth.uid();
end;
$$;

-- 監査：希望・提出記録・確定記録の変更も追えるようにする
drop trigger if exists shift_requests_audit on shift_requests;
create trigger shift_requests_audit
  after insert or delete on shift_requests
  for each row execute function write_audit('biz_date');

drop trigger if exists shift_request_submissions_audit on shift_request_submissions;
create trigger shift_request_submissions_audit
  after insert or update or delete on shift_request_submissions
  for each row execute function write_audit('ym');

drop trigger if exists shift_publications_audit on shift_publications;
create trigger shift_publications_audit
  after insert or update or delete on shift_publications
  for each row execute function write_audit('ym');

revoke execute on function public.submit_month_requests(text, date[]) from public, anon;
revoke execute on function public.confirm_month_shifts(text, jsonb)   from public, anon;
grant  execute on function public.submit_month_requests(text, date[]) to authenticated;
grant  execute on function public.confirm_month_shifts(text, jsonb)   to authenticated;
