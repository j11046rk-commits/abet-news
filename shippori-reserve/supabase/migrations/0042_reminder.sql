-- 0042 前日リマインドを送った印
--
-- ★同じ人に2回送らない、が目的。
--   定期実行は「1日1回きっかり」ではない。動かなかった日に手で叩くこともあるし、
--   何かの拍子に2回走ることもある。送った印を残しておかないと、
--   お客様のトークに同じ文面が2通並ぶ——予約の連絡としては、いちばん信用を落とす形。
--
--   「今日はもう送った」という時刻ではなく、**予約1件ごと**に印を付ける。
--   1日分の途中で失敗しても、送れた人にだけ印が付き、次に走ったとき
--   残りから再開できる。

alter table reservations add column if not exists reminded_at timestamptz;

comment on column reservations.reminded_at is
  '前日リマインドをお送りした時刻。null なら未送信。同じ予約に2度送らないための印';

-- 明日ぶんの未送信だけを引く。件数は多くないが、毎日必ず通る道なので索引を置く
create index if not exists reservations_remind_idx
  on reservations (biz_date)
  where reminded_at is null and line_user_id is not null;
