-- 0071 ロス（捨てたもの）は写真を撮るだけ → 毎朝の読み取り役（サブスクのClaude）が品名・金額の目安を入れる
--      （店主指示 2026-11-09「グループLINEに上げている代わりに、システムに写真を上げる形にしたい。原価タブで毎日のロスを登録」）
--
--   仕入の書類と同じ流れ：読み取り待ち（pending）→ 未確認（unconfirmed・金額入り）→ 確認済み（confirmed）
--   読み取り待ちの間は、品名・金額・理由が空でよい。それ以外は今までどおり必須。

alter table cost_losses add column if not exists status text not null default 'confirmed'
  check (status in ('pending', 'unconfirmed', 'confirmed'));
alter table cost_losses add column if not exists ai_note text check (ai_note is null or length(ai_note) <= 500);
alter table cost_losses add column if not exists read_at timestamptz;

alter table cost_losses alter column item drop not null;
alter table cost_losses alter column amount_ex drop not null;
alter table cost_losses alter column reason drop not null;

alter table cost_losses drop constraint if exists cost_losses_filled;
alter table cost_losses add constraint cost_losses_filled
  check (status = 'pending' or (item is not null and amount_ex is not null and reason is not null));

create index if not exists cost_losses_pending on cost_losses (created_at) where status = 'pending';

comment on column cost_losses.status is 'pending＝撮っただけ / unconfirmed＝読み取り役が品名・金額の目安を入れた / confirmed＝人が確かめた（手で入れた行も）';
