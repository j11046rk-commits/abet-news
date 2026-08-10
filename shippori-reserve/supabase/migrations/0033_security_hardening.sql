-- 0033 セキュリティ監査で見つかった穴を塞ぐ（2026-08-11）
--
-- 予約者の氏名と電話番号を守るための回。運用ルールではなく、仕組みで塞ぐ。
-- 見つかったもののうち、DB側で直すぶんをここにまとめる。

-- ─────────────────────────────────────────────────────────────
-- 1) 公開APIの回数制限を入れるための土台
--
-- SMS送信も公開キャンセルも、いまは何回でも叩ける。
-- 電話番号を変えながら回せば、店のTwilio残高で他人にSMSを撃ち込める。
-- 番号を変えても効くのは「宛先ごと」ではなく「全体の天井」なので、3段で見る。
-- ─────────────────────────────────────────────────────────────
create table if not exists public_attempts (
  id         bigserial primary key,
  kind       text not null,               -- 'sms' / 'cancel'
  subject    text,                        -- 電話番号や予約番号のハッシュ（生値は入れない）
  ip         text,
  ok         boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists public_attempts_recent
  on public_attempts (kind, created_at desc);
create index if not exists public_attempts_subject
  on public_attempts (kind, subject, created_at desc);

alter table public_attempts enable row level security;
-- ポリシーを1つも作らない＝service role 以外は触れない
revoke all on public_attempts from public, anon, authenticated;

comment on table public_attempts is
  '公開APIの試行回数。個人情報は入れない（subject はハッシュ）。service role のみ読み書き';

-- 古い記録は溜めない。回数を見るのが目的で、履歴を残すのが目的ではない。
create or replace function public.sweep_public_attempts()
returns void language sql security definer set search_path = public as $$
  delete from public_attempts where created_at < now() - interval '2 days';
$$;
revoke execute on function public.sweep_public_attempts() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2) キャンセルの鍵を、推測できない値にする
--
-- 予約番号 R-YYMM-NNNN は月ごとの連番。電話番号を1つ知っていれば、
-- 0001 から順に投げるだけで他人の予約を消せるし、消さなくても
-- 「この番号の人がこの店に予約している」ことを確かめられる。
-- 番号は電話口で読み上げる表示用として残し、鍵は別に持つ。
-- ─────────────────────────────────────────────────────────────
alter table reservations
  add column if not exists cancel_token uuid not null default gen_random_uuid();

comment on column reservations.cancel_token is
  'Webキャンセルの鍵。予約番号は連番で推測できるので、URLにはこちらを載せる';

-- ─────────────────────────────────────────────────────────────
-- 3) 関数の EXECUTE 権限を締める
--
-- PostgreSQL は新しい関数の EXECUTE を既定で PUBLIC に与える。
-- revoke を1本書き忘れた ensure_business_day() は、いま anon から呼べる状態で、
-- security definer なので RLS を無視して business_days を返してしまう。
-- 「書き忘れない」という運用ではなく、既定値そのものを変えて塞ぐ。
-- ─────────────────────────────────────────────────────────────
revoke execute on all functions in schema public from public, anon;
-- これから作る関数も、既定で anon には渡さない
alter default privileges in schema public revoke execute on functions from public, anon;

-- anon に戻す関数は無い。
-- 公開予約（net_reserve）はブラウザからではなく、サーバー側が service role で呼んでいる。
-- ブラウザ用の Supabase クライアント（src/lib/supabase/client.ts）は
-- どこからも import されていないので、anon が DB を直接触る経路は存在しない。

-- ─────────────────────────────────────────────────────────────
-- 4) 席ボードと予約停止を「有効なスタッフ」だけに
--
-- いまの検査は auth.uid() is null だけ。退職者は profiles.is_active を
-- false にしても Supabase Auth 側は生きているので、古いパスワードで
-- トークンを取れば席を全部埋められる＝ネット予約を止められる。
-- ─────────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  -- 既存の定義の「ログインが必要です」判定だけを差し替える
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_seat_board';
  if v_src is not null then
    v_src := replace(v_src, 'if auth.uid() is null then', 'if not public.is_active_user() then');
    execute v_src;
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_net_pause';
  if v_src is not null then
    v_src := replace(v_src, 'if auth.uid() is null then', 'if not public.is_active_user() then');
    execute v_src;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 5) 席まわりのテーブルを anon から切り離す
--
-- 0009 の revoke は「その時点で存在したテーブル」にしか効いていない。
-- そのあとに足した seat_board / seat_slots / seat_log / net_pause は、
-- anon の権限が付いたまま。読み取りポリシーも using(true) で、
-- ログインさえしていれば退職者でもフロアの状況が読める。
-- ─────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['seat_board','seat_slots','seat_log','net_pause'] loop
    if exists (select 1 from information_schema.tables
                where table_schema='public' and table_name=t) then
      execute format('alter table %I enable row level security', t);
      execute format('revoke all on %I from public, anon', t);
      execute format('grant select on %I to authenticated', t);
      -- 読み取りは「有効なスタッフ」に限る
      execute format('drop policy if exists %I on %I', t || '_select', t);
      execute format(
        'create policy %I on %I for select to authenticated using (is_active_user())',
        t || '_select', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 6) 監査ログから個人情報の値を落とす
--
-- write_audit() は before/after に行を丸ごと入れている。予約1件ごとに
-- 氏名・電話・メモの完全なコピーが audit_logs に増え続け、画面も保持期間も無い。
-- しかも将来「氏名を伏せる」UPDATE を流すと、その UPDATE 自体が
-- before に平文を新しく書き込む。マスクするほど平文が増える。
-- 先にここを直さないと、保持期間の実装が丸ごと無駄になる。
--
-- 「誰がいつどの予約を触ったか」は残るので、監査の目的は損なわれない。
-- 値のハッシュも入れない（電話番号は10^11通りしかなく、総当たりで戻せる）。
-- ─────────────────────────────────────────────────────────────
create or replace function public.write_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  key_col text   := coalesce(tg_argv[0], 'id');
  pii     text[] := array['customer_name','customer_kana','phone','memo',
                          'allergy','invoice_name','source_detail','cancel_reason'];
  b jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  a jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  rec jsonb := coalesce(a, b);
  k text;
begin
  if tg_table_name = 'reservations' then
    foreach k in array pii loop
      if b ? k and b->>k is not null then b := jsonb_set(b, array[k], '"***"'::jsonb); end if;
      if a ? k and a->>k is not null then a := jsonb_set(a, array[k], '"***"'::jsonb); end if;
    end loop;
  end if;
  insert into audit_logs (actor, action, target_table, target_id, before, after)
  values (auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name, rec ->> key_col, b, a);
  return coalesce(new, old);
end;
$$;

-- すでに貯まっているぶんを1回だけ洗う
update audit_logs
   set before = before - 'customer_name' - 'customer_kana' - 'phone' - 'memo'
                       - 'allergy' - 'invoice_name' - 'source_detail' - 'cancel_reason',
       after  = after  - 'customer_name' - 'customer_kana' - 'phone' - 'memo'
                       - 'allergy' - 'invoice_name' - 'source_detail' - 'cancel_reason'
 where target_table = 'reservations'
   and (before is not null or after is not null);

-- ─────────────────────────────────────────────────────────────
-- 7) 連絡先の保存期間
--
-- 来店日から13か月たった予約の「連絡先だけ」を消す。
-- 人数・時刻・流入元・席・状態は残すので、売上と集計は無傷。
-- 基準は status ではなく biz_date にする。status を手で completed に
-- 変える運用は忙しい店では回らず、大半が confirmed のまま残るため。
--
-- 呼び出しは pg_cron が使えるなら日次、使えないなら
-- 週次レポートのバッチから RPC で1日1回呼ぶ。
-- ─────────────────────────────────────────────────────────────
create or replace function public.purge_reservation_pii(p_months integer default 13)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update reservations
     set customer_name = '（保存期間経過）',   -- NOT NULL かつ空文字禁止なので置き換える
         customer_kana = null,
         phone         = null,
         memo          = null,
         allergy       = null,
         invoice_name  = null,
         source_detail = null
   where biz_date < (now() at time zone 'Asia/Tokyo')::date - make_interval(months => p_months)
     and customer_name <> '（保存期間経過）';
  get diagnostics n = row_count;
  insert into audit_logs (actor, action, target_table, target_id, before, after)
  values (null, 'reservations.purge', 'reservations', null, null,
          jsonb_build_object('rows', n, 'months', p_months));
  return n;
end;
$$;
revoke execute on function public.purge_reservation_pii(integer) from public, anon, authenticated;

comment on function public.purge_reservation_pii(integer) is
  '来店日から指定月数を過ぎた予約の連絡先を消す。人数・時刻・流入元は残す';
