-- 0060 名前チップの表示名（店主要望 2026-11-02）
--
-- シフト・暦・タイムバーの名前チップは「姓」を出している（安藤 正 → 安藤）。
-- 同じ姓の人がいると見分けられない（古賀 杏奈 と オーナーの古賀）。
-- その人だけ、チップに出す短い名前を決められるようにする。空なら従来どおり姓。

alter table profiles add column if not exists short_name text
  check (short_name is null or char_length(btrim(short_name)) between 1 and 8);

update profiles set short_name = '杏奈' where login_id = 'kogaanna' and short_name is null;
