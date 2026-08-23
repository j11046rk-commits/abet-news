-- 0035 2026年の売上目標を「日次の合計＝月間目標」にそろえる（店主指示 2026-08-11）
--
-- 日毎目標（0019）は月間目標を曜日指数で割って作ったので、配分の丸めで
-- 毎月数円の端数が出ていた。店主の指示で、端数はその月の**営業最終日**に寄せて
-- 日次の合計と月間目標をぴったり一致させる。
--
-- ずれは最大でも6円（11月）。営業最終日の目標が数円動くだけで、
-- 日々の運用には何の影響もない。逆に、ここが合っていないと
-- 「日毎を全部達成したのに月間が1円足りない」という気持ち悪い状態が起きる。
--
-- あわせて、1〜5月の月間目標が抜けていたので入れる。
-- 値は日次の合計を1万円単位に丸めたもの（差はいずれも±6円以内なので一意に決まる）。
--
--   月        日次の合計    月間目標     端数
--   2026-01   3,000,002    3,000,000      -2   ← 月間目標を新設
--   2026-02   3,000,000    3,000,000       0   ← 月間目標を新設
--   2026-03   3,799,999    3,800,000      +1   ← 月間目標を新設
--   2026-04   2,839,996    2,840,000      +4   ← 月間目標を新設
--   2026-05   2,929,998    2,930,000      +2   ← 月間目標を新設
--   2026-06   2,689,999    2,690,000      +1
--   2026-07   2,750,002    2,750,000      -2
--   2026-08   3,119,997    3,120,000      +3
--   2026-09   2,780,002    2,780,000      -2
--   2026-10   2,110,003    2,110,000      -3
--   2026-11   2,839,994    2,840,000      +6
--   2026-12   3,939,998    3,940,000      +2

-- ── 1) 抜けていた月間目標を入れる ──────────────────────────
insert into sales_monthly (ym, target_yen) values
  ('2026-01', 3000000),
  ('2026-02', 3000000),
  ('2026-03', 3800000),
  ('2026-04', 2840000),
  ('2026-05', 2930000)
on conflict (ym) do nothing;

-- ── 2) 端数を営業最終日に寄せる ────────────────────────────
--
-- 営業最終日＝その月で target_yen が 0 より大きい最後の日。
-- 火曜定休の日は 0 が入っているので、そこを最終日に選ばないようにする
-- （2026年4月から火曜定休。3月までは火曜も営業しているので 3/31(火) が正しく最終日になる）。
--
-- 差が0なら何もしない＝この回を何度流しても結果は同じ。
do $$
declare
  r      record;
  v_sum  integer;
  v_last date;
  v_diff integer;
begin
  for r in select ym, target_yen from sales_monthly where ym like '2026-%' order by ym loop
    select sum(target_yen), max(biz_date)
      into v_sum, v_last
      from sales_daily
     where to_char(biz_date, 'YYYY-MM') = r.ym
       and coalesce(target_yen, 0) > 0;

    continue when v_last is null;              -- 日毎目標がまだ無い月は触らない

    v_diff := r.target_yen - coalesce(v_sum, 0);
    continue when v_diff = 0;

    -- 端数が数円で収まらないなら、それは丸めではなく入力の食い違い。
    -- 黙って直さず止める（12月の桁違いのようなケースを吸収してしまわないため）。
    if abs(v_diff) > 100 then
      raise exception '% の端数が % 円で、丸めの範囲を超えています。目標そのものを確認してください。',
        r.ym, v_diff;
    end if;

    update sales_daily
       set target_yen = target_yen + v_diff
     where biz_date = v_last;
  end loop;
end $$;

-- ── 3) そろったことを確かめる ──────────────────────────────
do $$
declare r record; v_sum integer;
begin
  for r in select ym, target_yen from sales_monthly where ym like '2026-%' loop
    select coalesce(sum(target_yen), 0) into v_sum
      from sales_daily
     where to_char(biz_date, 'YYYY-MM') = r.ym and coalesce(target_yen, 0) > 0;
    if v_sum <> r.target_yen then
      raise exception '% がそろっていません（日次の合計 % ／ 月間目標 %）', r.ym, v_sum, r.target_yen;
    end if;
  end loop;
end $$;
