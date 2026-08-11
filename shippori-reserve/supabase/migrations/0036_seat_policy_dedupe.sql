-- 0036 席まわりの読み取りポリシーの二重掛けを解く（0033 の取りこぼし）
--
-- 0033 で seat_board / seat_slots / seat_log / net_pause の読み取りを
-- is_active_user() に絞ったつもりだったが、効いていなかった。
--
-- 元からあったポリシー名が <table>_read で、0033 が作ったのは <table>_select。
-- PostgreSQL の permissive なポリシーは **OR で結合される** ので、
--   (true) OR (is_active_user())
-- となって常に真。つまり退職者でもフロアの状況が読めるままだった。
--
-- 教訓：ポリシーを「置き換える」つもりのときは、同じ名前で作り直すか、
-- 古いほうを名指しで消すこと。名前を変えて足すと、足しただけになる。
--
-- 書き込みのポリシーは元々1つも無い（更新は security definer 関数だけが行う）ので、
-- SELECT のポリシーを1本にするだけでよい。

do $$
declare
  t text;
  p record;
begin
  foreach t in array array['seat_board','seat_slots','seat_log','net_pause'] loop
    if not exists (select 1 from information_schema.tables
                    where table_schema='public' and table_name=t) then
      continue;
    end if;

    -- この表の SELECT ポリシーのうち、今回の <table>_select 以外を全部落とす
    for p in
      select pol.polname
        from pg_policy pol
        join pg_class c on c.oid = pol.polrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = t
         and pol.polcmd = 'r'
         and pol.polname <> t || '_select'
    loop
      execute format('drop policy %I on %I', p.polname, t);
    end loop;

    -- 念のため、残す1本を作り直す（0033 が流れていない環境でも成立させる）
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format(
      'create policy %I on %I for select to authenticated using (is_active_user())',
      t || '_select', t);
  end loop;
end $$;

-- 確かめる：SELECT ポリシーがちょうど1本で、条件が is_active_user() であること
do $$
declare t text; v_cnt integer; v_qual text;
begin
  foreach t in array array['seat_board','seat_slots','seat_log','net_pause'] loop
    if not exists (select 1 from information_schema.tables
                    where table_schema='public' and table_name=t) then
      continue;
    end if;
    select count(*), max(pg_get_expr(pol.polqual, pol.polrelid))
      into v_cnt, v_qual
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relname = t and pol.polcmd = 'r';
    if v_cnt <> 1 or v_qual <> 'is_active_user()' then
      raise exception '% の読み取りポリシーが想定と違います（% 本 / %）', t, v_cnt, v_qual;
    end if;
  end loop;
end $$;
