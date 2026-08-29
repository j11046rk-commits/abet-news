-- 0051 LINE友だち数のKPI（目標人数・店主要望 2026-08-29）
--
-- 店頭での友だち追加の声かけを全員でやるにあたり、目標を数字で置いて
-- 暦と売上タブに「目標まであと◯人」と進捗バーを出す。
-- 最初の目標は50人（スタッフへの全体指示と同じ数字）。
-- 変えるときはこの値を書き換えるだけ（表示は次の読み込みから変わる）。

insert into settings (key, value) values ('line_followers_target', '50'::jsonb)
on conflict (key) do nothing;
