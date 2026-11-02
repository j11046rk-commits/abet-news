-- 0061 来店後の口コミのお願い（店主要望 2026-11-02・Googleマップの順位対策）
--
-- 送ったお客様を1行ずつ記録する。同じ人に何度も送らないため（常連さんに毎回届くと迷惑）。
-- 中身はLINEのユーザーIDと送った日時だけ。画面やAPIからは読めない（RLSで方針なし）。
create table if not exists review_requests (
  line_user_id   text primary key,
  reservation_id uuid references reservations(id) on delete set null,
  sent_at        timestamptz not null default now()
);
alter table review_requests enable row level security;
