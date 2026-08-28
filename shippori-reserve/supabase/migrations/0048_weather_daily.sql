-- 0048 日毎の天気（店主要望 2026-08-28）
--
-- 「天気と売り上げの相関関係がないかを調べたい」——雨の日に客足がどう変わるかを
-- 売上と並べて見るため。晴・曇・雨の3区分で十分（店主指定）。
--
-- 取得は Mac の日次取り込み（エアレジと同乗・毎日3回）が気象庁の
-- 新居浜アメダスの日別値（降水量・気温・日照時間）から区分を導き、
-- /api/weather/ingest へ送る。予報は入れない——実測だけ（過ぎた日に付く）。

create table if not exists weather_daily (
  biz_date   date primary key,
  -- sunny / cloudy / rainy の3区分。雨（降水1mm以上）が最優先、
  -- 残りは日照時間の長短で晴と曇に分ける
  weather    text not null check (weather in ('sunny', 'cloudy', 'rainy')),
  precip_mm  numeric(6,1),
  temp_max_c numeric(4,1),
  temp_min_c numeric(4,1),
  updated_at timestamptz not null default now()
);

alter table weather_daily enable row level security;

-- 読むのはログイン済みスタッフ（暦・売上タブ）。書くのは service role（取り込みAPI）だけ
do $$ begin
  create policy weather_daily_read on weather_daily for select to authenticated using (true);
exception when duplicate_object then null; end $$;

revoke all on weather_daily from public, anon;
grant select on weather_daily to authenticated;
