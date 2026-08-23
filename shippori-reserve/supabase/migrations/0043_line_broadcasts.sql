-- 0043 クーポン配信の記録
--
-- 「いつ・何人に・何を送ったか」を残す。目的は2つ。
--   ① 送りすぎを止める判定に使う（前回から日が浅ければ送らない）。
--      配信は1回で友だちの人数ぶんの通数を使うので、静かな日が続くと
--      無料枠200通が一瞬で消える。記録が無いと「送りすぎ」を機械が判定できない。
--   ② あとで「配信した日に何人来たか」を売上と突き合わせる（効果測定）。
--      配信が売上につながっているかは、この記録と sales_daily を並べれば分かる。

create table if not exists line_broadcasts (
  id      uuid primary key default gen_random_uuid(),
  -- 'quiet_day'（予約ゼロの日の自動クーポン）など。手動配信は記録されない点に注意
  kind    text not null,
  sent_at timestamptz not null default now(),
  -- 届いた見込み人数（友だち数）。通数の消費もこれとほぼ同じ
  reach   integer,
  note    text
);

alter table line_broadcasts enable row level security;
revoke all on line_broadcasts from anon, authenticated;

-- 読むのは店の中の人だけ。書き込みは定期実行（service role）だけ
grant select on line_broadcasts to authenticated;
drop policy if exists line_broadcasts_select on line_broadcasts;
create policy line_broadcasts_select on line_broadcasts
  for select to authenticated using (is_active_user());
