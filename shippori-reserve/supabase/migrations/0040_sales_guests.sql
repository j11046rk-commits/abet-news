-- 0040 客数と会計数（組数）を売上に持たせる（店主要望 2026-08-18）
--
-- エアレジの日別売上には、金額のほかに「会計数・客数・客単価」が並んでいる。
-- 週次レポートは前からこれを読んで LINE に流していたが、予約アプリには
-- 金額しか渡していなかった。だから売上タブでは客単価が見られない。
--
-- 客単価は割り算なので**保存しない**。客数と会計数という事実だけ持ち、
-- 割るのは画面の1か所（src/lib/sales.ts）でやる。保存した平均は、
-- あとから実績を直したときに置いていかれて、必ず食い違う。
--
-- 「客数」＝お客様の人数（エアレジの客数）。「会計数」＝伝票の枚数＝おおよその組数。
-- 未取得の日は null。0 を入れないこと——「読めなかった日」と「0名だった日」は違う。

alter table sales_daily add column if not exists guest_count integer
  check (guest_count is null or (guest_count >= 0 and guest_count <= 10000));
alter table sales_daily add column if not exists check_count integer
  check (check_count is null or (check_count >= 0 and check_count <= 10000));

comment on column sales_daily.guest_count is
  '客数（エアレジの日別売上より）。お持ち帰りだけのお客様も含む。未取得の日は null';
comment on column sales_daily.check_count is
  '会計数＝伝票の枚数（おおよその組数）。未取得の日は null';
