-- 0055 クーポンの割引額（店主指示 2026-09-10）
--
-- クーポンの値引きは売上の減少ではなく広告費。日毎の目標達成の判定では
-- 割引前の店内売上で比べる——値引きが目標の足を引っ張ると、
-- スタッフがクーポンやLINE登録の声かけをためらうようになるため。
--
-- 金額は「割引いた額」を正の数で持つ（エアレジの商品別売上で
-- 「クーポン」を含む商品のマイナス売上を符号反転して合計）。
-- null = まだ数えていない日、0 = 数えたが割引なし。
alter table sales_daily
  add column if not exists coupon_yen integer
  check (coupon_yen is null or (coupon_yen >= 0 and coupon_yen <= 100000000));
