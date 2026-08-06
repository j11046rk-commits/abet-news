-- The Oldmans — 0011 水道代・電気代の未記帳アラート
--
-- 家賃と共益費は金額が決まっているので自動で起票できる（0009）。
-- 水道代と電気代は毎月変わるので自動化できない。かわりに「その月まだ入っていない」
-- ことを画面から言うようにする。抜けたまま月をまたぐのがいちばん困る。
--
-- 請求は使った月の翌月に来る。開始月（2026-08）ぶんの請求は2026-09に届くので、
-- それより前の月では警告を出さない。この境目は settings で動かせるようにしておく。

alter table settings
  add column if not exists utilities_alert_from text not null default '2026-09';

comment on column settings.utilities_alert_from is
  '水道代・電気代の未記帳アラートを出しはじめる年月（YYYY-MM）。これより前の月では警告しない。';

alter table settings
  add constraint settings_utilities_alert_from_fmt
  check (utilities_alert_from ~ '^\d{4}-\d{2}$');
