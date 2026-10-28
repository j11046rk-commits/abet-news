-- 0059 人時売上（店主要望 2026-10-28）
--
-- freee人事労務の勤怠から、日ごとの「全員の労働時間の合計」を取り込み、
-- 売上 ÷ 労働時間 ＝ 人時売上 を暦と売上一覧に出す。
--
-- 1日1行。人ごとの内訳は持たない（画面に要るのは合計だけ。
-- 誰が何時間働いたかは freee が正で、ここに写すと二重管理になる）。

create table if not exists labor_daily (
  biz_date   date primary key,
  work_min   integer not null check (work_min >= 0),   -- 全員の労働時間の合計（分・休憩を除く）
  headcount  integer not null default 0 check (headcount >= 0), -- 勤怠があった人数
  fetched_at timestamptz not null default now()
);

alter table labor_daily enable row level security;
grant select on labor_daily to authenticated;
drop policy if exists labor_daily_select on labor_daily;
create policy labor_daily_select on labor_daily
  for select to authenticated using (is_active_user());

-- 外部サービスとの連携の鍵（freee の OAuth トークンなど）。
-- RLS を有効にして方針を置かない＝画面やAPIからは読めない。サーバー（service role）だけが触る。
create table if not exists integration_tokens (
  provider          text primary key,          -- 'freee_hr'
  refresh_token     text not null,
  access_token      text,
  access_expires_at timestamptz,
  company_id        bigint,
  company_name      text,
  connected_at      timestamptz not null default now(),
  last_sync_at      timestamptz,
  last_error        text
);

alter table integration_tokens enable row level security;
