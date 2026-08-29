-- 0052 LINE友だち目標を「月ごとに増える形」に（店主要望 2026-08-29）
--
-- 声かけの目安「平日+2人・金土+3人（火曜定休は0）」を今日時点の37人に
-- 積み上げた、各月末時点の目標。単一値(line_followers_target)は廃止。
-- ペースを変えたくなったら、この値を書き換えるだけでよい。

insert into settings (key, value) values (
  'line_followers_targets',
  '{"2026-08": 44, "2026-09": 102, "2026-10": 166, "2026-11": 226, "2026-12": 286}'::jsonb
)
on conflict (key) do update set value = excluded.value;

delete from settings where key = 'line_followers_target';
