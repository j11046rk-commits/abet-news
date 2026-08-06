-- The Oldman — 0008 朝10時の自動チェックアウト
--
-- チェックアウトの押し忘れ対策。毎朝10時（JST）に、まだ滞在中の行を締める。
-- 締めた時刻は 10:00 とし、`auto_closed` で「本人が押したのではない」ことを残す。
--
-- 実際に何時に帰ったかは分からない。だから「10時で締めた」という事実だけを記録し、
-- 利用時間の集計でそれが本人の申告と混ざらないようにする。

alter table check_ins add column if not exists auto_closed boolean not null default false;

comment on column check_ins.auto_closed is
  '朝10時の自動締めで閉じた行。本人がチェックアウトを押していないことを示す。';

-- ── 締める関数 ──────────────────────────────────────────────────────────
-- security definer：cron は postgres として動くが、意図を明示しておく。
create or replace function public.close_stale_check_ins()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update check_ins
     set checked_out_at = now(),
         auto_closed = true
   where checked_out_at is null
     and checked_in_at < now();   -- 制約 checked_out_at > checked_in_at を守る

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.close_stale_check_ins() from public, anon, authenticated;

-- ── 毎朝10時（JST）に実行 ───────────────────────────────────────────────
-- pg_cron は UTC で動く。JST 10:00 = UTC 01:00。
-- 同名のジョブが既にあれば消してから作り直す（再実行できるように）。
do $$
begin
  perform cron.unschedule('the-oldman-auto-checkout')
   where exists (select 1 from cron.job where jobname = 'the-oldman-auto-checkout');

  perform cron.schedule(
    'the-oldman-auto-checkout',
    '0 1 * * *',
    $cron$select public.close_stale_check_ins();$cron$
  );
end $$;
