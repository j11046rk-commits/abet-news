-- 0066 原価：写真は撮るだけ。読み取りはあとでまとめて（API料金を使わない）
--
-- 店主指示（2026-11-06）「APIは消費したくない。店長が毎日撮って、それを取りに行って
-- サブスクのClaudeで解析する」。
--
--   撮る（店長・毎日）→ 読み取り待ち（pending）
--   → 毎朝、Claude（定期実行のセッション）が /api/cost/reader から取りに来て読む
--   → 未確認（unconfirmed）：金額は入っていて原価率にも入る。写真と見比べて「確認した」か「直す」
--   → 確認済み（confirmed）。手で入れた行は最初から確認済み
--
-- 読み取り口の合言葉は、オーナーが画面で発行する。保存するのはハッシュだけ（平文は発行した1回しか出ない）。

alter table cost_purchases
  add column if not exists status text not null default 'confirmed'
    check (status in ('pending', 'unconfirmed', 'confirmed')),
  add column if not exists ai_note text check (ai_note is null or length(ai_note) <= 500),
  add column if not exists read_at timestamptz;

-- 読み取り待ちの行は、業者名も金額もまだ無い
alter table cost_purchases alter column vendor drop not null;
alter table cost_purchases drop constraint if exists cost_purchases_vendor_check;
alter table cost_purchases add constraint cost_purchases_vendor_check
  check (status = 'pending' or (vendor is not null and length(btrim(vendor)) between 1 and 80));

create index if not exists cost_purchases_pending on cost_purchases (created_at) where status = 'pending';

-- 外から来る機械（定期実行など）の合言葉。ハッシュだけを持つ。画面からは読めない（RLSで方針なし）
create table if not exists api_tokens (
  name        text primary key check (name ~ '^[a-z][a-z0-9_]{1,40}$'),
  token_hash  text not null,                     -- sha256(合言葉) の16進
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  last_used_at timestamptz
);
alter table api_tokens enable row level security;
