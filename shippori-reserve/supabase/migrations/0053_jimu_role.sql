-- 0053 役職「事務(jimu)」を追加（店主要望 2026-09-01・檜垣さんの入社にあわせて）
--
-- 予約対応と数字の閲覧はスタッフと同じ。シフトには一切出ない
-- （希望提出もシフト表の候補にも載らない）。
--
-- ★ALTER TYPE ... ADD VALUE は同一トランザクションで新しい値を使えないため、
--   この2文は別々に流すこと。

alter type user_role add value if not exists 'jimu';

-- （別トランザクションで）
insert into role_permissions (role, permission)
select 'jimu', v.p
from (values ('reservation.read'), ('reservation.write'), ('reservation.override'), ('stats.read')) v(p)
where not exists (
  select 1 from role_permissions rp where rp.role = 'jimu' and rp.permission = v.p
);
