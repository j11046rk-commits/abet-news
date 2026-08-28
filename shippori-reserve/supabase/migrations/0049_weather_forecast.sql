-- 0049 天気に「予報」を追加（店主要望 2026-08-28）
--
-- この先1週間の予報も暦に出す。予報は毎日の取り込みのたびに取り直すので、
-- 日が近づくほど新しい（＝当たりやすい）予報に置き換わる。
-- 日が過ぎたらアメダスの実測が予報を上書きし、is_forecast が false になる。
-- 逆向き（予報が実測を上書き）は取り込みAPI側で禁止する。

alter table weather_daily
  add column if not exists is_forecast boolean not null default false;
