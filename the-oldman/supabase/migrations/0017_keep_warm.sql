-- The Oldmans — 0017 Vercel の関数を眠らせない
--
-- Hobby プランの関数は、しばらく呼ばれないと眠る。次に開いた1人が
-- コールドスタート（2秒前後）を払う。6人が夜だけ使うこのサイトでは
-- 「開くたびに遅い」として体感される。
--
-- Supabase 側は常時起きているので、pg_cron + pg_net で5分おきに
-- /api/ping を叩き、関数を起こしたままにする。ping は認証にも DB にも
-- 触れない素通しのエンドポイント（middleware も素通りさせている）。
--
-- 5分おき × 1ヶ月 ≈ 8,600回。Vercel Hobby の関数呼び出し枠（100万/月）
-- にも pg_net の負荷にも遠く及ばない。

create extension if not exists pg_net with schema extensions;

-- 二重登録を避ける（再実行しても安全）
do $$
begin
  if exists (select 1 from cron.job where jobname = 'the-oldman-warm') then
    perform cron.unschedule('the-oldman-warm');
  end if;
end $$;

select cron.schedule(
  'the-oldman-warm',
  '*/5 * * * *',
  $$ select net.http_get('https://the-oldmans.vercel.app/api/ping') $$
);
