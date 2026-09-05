-- 0054 クーポンの使用回数（店主要望 2026-09-05）
--
-- LINEで配ったクーポン（−500円）が実際にレジを何回通ったか。
-- エアレジの商品別売上から「クーポン」を含む商品の販売数を
-- Macの日次取り込みが数えて送ってくる。
--
-- null = まだ数えていない日（過去日・取り込み前）
-- 0    = 数えたが使用なし —— 「不明」と「ゼロ」を区別する
alter table sales_daily
  add column if not exists coupon_count integer
  check (coupon_count is null or (coupon_count >= 0 and coupon_count <= 10000));
