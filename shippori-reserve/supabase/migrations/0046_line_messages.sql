-- 0046 お客様からのLINEメッセージを席ボードに知らせる（店主要望 2026-08-24）
--
-- トークでの変更・キャンセル連絡は店のLINEグループへ転送しているが、
-- 営業中は誰もグループを見ない——気づかないままお客様を待たせる。
-- ネット予約と同じく、レジ横のタブレットに音つきで出すため、
-- 届いたメッセージをここに置き、席ボードの15秒ポーリングで拾う。
--
-- ★これはPII（お客様の発言そのもの）。長く貯めない。
--   webhookが書き込むたびに30日より古い行を消す（お知らせ用であり、台帳ではない）。

create table if not exists line_messages (
  id           bigint generated always as identity primary key,
  line_user_id text not null,
  text         text not null,
  created_at   timestamptz not null default now()
);

create index if not exists line_messages_created on line_messages (created_at);

alter table line_messages enable row level security;

-- 読むのはログイン済みスタッフ（席ボード）。書くのは service role（webhook）だけ
do $$ begin
  create policy line_messages_read on line_messages for select to authenticated using (true);
exception when duplicate_object then null; end $$;

revoke all on line_messages from public, anon;
grant select on line_messages to authenticated;
