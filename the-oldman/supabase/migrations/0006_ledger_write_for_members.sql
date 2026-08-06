-- The Oldmans — 0006 台帳の書き込みを全メンバーに開放
--
-- 変更理由：この施設は6人で回している。会計を一人に属人化させないという設計意図
-- （SPEC §1 G4）に照らすと、閲覧だけ開いて記帳を owner に閉じるのは中途半端だった。
-- 6人全員が記帳・編集・削除できるようにする。
--
-- ただしセッションから自動起票された行（session_id が入っている行）は対象外。
-- あれはセッションの数字の写しなので、台帳側から直接いじらせない。
-- 0004 のトリガは security definer で動くため、この制限の影響を受けない。

drop policy if exists ledger_insert_owner on ledger_entries;
drop policy if exists ledger_update_owner on ledger_entries;
drop policy if exists ledger_delete_owner on ledger_entries;

create policy ledger_insert on ledger_entries
  for insert to authenticated
  with check (public.is_active_user() and session_id is null);

create policy ledger_update on ledger_entries
  for update to authenticated
  using (public.is_active_user() and session_id is null)
  with check (public.is_active_user() and session_id is null);

create policy ledger_delete on ledger_entries
  for delete to authenticated
  using (public.is_active_user() and session_id is null);

-- 固定費マスタと施設設定は owner のまま（金額の定義を変える操作なので）。
-- 「当月ぶんの固定費を計上する」は台帳への insert なので、上のポリシーで全員が実行できる。
