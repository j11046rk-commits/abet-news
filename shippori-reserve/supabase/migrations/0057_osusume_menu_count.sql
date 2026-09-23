-- 0057 本日のおすすめの品数を仕込み計算に反映（店主指示 2026-09-23）
--
-- おすすめを平日3種・金土5種で出す運用になった。仕込みの表示は
-- 全種の合計食数に変える:
--   仕込み食数 = 目安客数 × 仕込み率(1種あたり・25%) × 品数
-- 率は33%(全体で1品)から25%(1種あたり)へ読み替え。
update settings set value = '25'::jsonb where key = 'osusume_prep_rate';
insert into settings (key, value) values
  ('osusume_menu_weekday', '3'::jsonb),
  ('osusume_menu_frisat', '5'::jsonb)
on conflict (key) do nothing;
