-- 0015 確定後のシフトを日単位で直せるように（店主フィードバック 2026-08-08 その9）
--
-- 急な休みや交代は、月まるごと組み直すほどのことではない。
-- 確定済みの月に限り、その日のぶんだけ入れ替える関数を用意する。
-- 0014 と同じく security definer で、権限・対象者・確定済みかの検査は
-- 関数の中で必ず行う（PostgRESTから直接叩かれても抜け道にならない）。

create or replace function public.update_day_shifts(p_date date, p_profile_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_permission('shift.write') then
    raise exception '権限がありません。';
  end if;

  -- 未確定の月はシフト表から月ごと確定する（この関数は手直し専用）
  if not exists (
    select 1 from shift_publications where ym = to_char(p_date, 'YYYY-MM')
  ) then
    raise exception 'この月はまだ確定していません。シフト表から確定してください。';
  end if;

  -- オーナー・閲覧のみ・退職者はシフトに入れられない（0014 と同じ）
  if exists (
    select 1 from (select distinct unnest(p_profile_ids) as pid) x
    left join profiles p on p.id = x.pid
    where p.id is null or not p.is_active or p.role in ('owner', 'viewer')
  ) then
    raise exception 'シフトに入れられない人が含まれています。';
  end if;

  delete from shifts where biz_date = p_date;

  insert into shifts (biz_date, profile_id, created_by)
  select distinct p_date, x.pid, auth.uid()
  from unnest(p_profile_ids) as x(pid);
end;
$$;

revoke execute on function public.update_day_shifts(date, uuid[]) from public, anon;
grant  execute on function public.update_day_shifts(date, uuid[]) to authenticated;

-- shifts も 0012/0013 と同じく読み取り専用へ。
-- 書き込みは confirm_month_shifts（0014）と update_day_shifts（この関数）だけが行う。
-- テーブルへの直接書き込みを許すと、対象者の検査（オーナー除外など）を素通りできてしまう。
revoke insert, delete on shifts from authenticated;
drop policy if exists shifts_write on shifts;
