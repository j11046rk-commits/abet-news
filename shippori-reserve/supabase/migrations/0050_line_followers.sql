-- 0050 LINE公式アカウントの友だち数（日次スナップショット・店主要望 2026-08-28）
--
-- 「友だちを増やしたい。今何人で、いつ何人増えたかを暦で見たい」。
-- Macの日次取り込みが LINE のインサイトAPI(followers)からその日時点の
-- 総数を取り、/api/line/followers へ送る。前日との差が「その日の増減」。
-- 個人は一切入らない（数だけ）。

create table if not exists line_followers_daily (
  biz_date         date primary key,
  followers        integer not null,  -- 友だち総数（その日時点）
  targeted_reaches integer,           -- 属性が分かる友だち（配信の目安）
  blocks           integer,           -- ブロック中
  updated_at       timestamptz not null default now()
);

alter table line_followers_daily enable row level security;

-- 読むのはログイン済みスタッフ（暦）。書くのは service role（取り込みAPI）だけ
do $$ begin
  create policy line_followers_read on line_followers_daily for select to authenticated using (true);
exception when duplicate_object then null; end $$;

revoke all on line_followers_daily from public, anon;
grant select on line_followers_daily to authenticated;
