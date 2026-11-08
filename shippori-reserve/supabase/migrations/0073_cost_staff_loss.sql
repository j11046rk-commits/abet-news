-- 0073 原価タブはスタッフにも出す・ロスは「まかない」も（店主指示 2026-11-09
--      「原価タブはスタッフにも出て大丈夫」「まかないで消費したものもロス。ちゃんと書いて」）
--
--   ・スタッフ：原価の閲覧（cost.read）と、ロスの写真を撮ること（cost.loss）だけ。
--     仕入・棚卸・ロスの直し・消しは今までどおり cost.write（オーナー・店長・事務）。給与はここに無い。
--   ・ロスの理由に「まかない」（staff_meal）を足す。

insert into permissions (code, label) values
  ('cost.loss', 'ロス（廃棄・まかない）の写真を撮る')
on conflict (code) do nothing;

insert into role_permissions (role, permission) values
  ('owner', 'cost.loss'), ('manager', 'cost.loss'), ('jimu', 'cost.loss'),
  ('staff', 'cost.read'), ('staff', 'cost.loss')
on conflict do nothing;

-- 写真だけのロス（読み取り待ち）を、cost.loss の人が自分の名前で足せる。直す・消すは cost.write の方針のまま
drop policy if exists cost_losses_photo_insert on cost_losses;
create policy cost_losses_photo_insert on cost_losses for insert to authenticated
  with check (has_permission('cost.loss') and status = 'pending' and created_by = auth.uid());

alter table cost_losses drop constraint if exists cost_losses_reason_check;
alter table cost_losses add constraint cost_losses_reason_check
  check (reason in ('expired', 'overprep', 'mistake', 'damaged', 'staff_meal', 'other'));
