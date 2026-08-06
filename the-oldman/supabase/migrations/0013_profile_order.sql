-- The Oldmans — 0013 メンバーの並び順を固定する
--
-- これまでは role → joined_on の順に出していたが、6人とも owner で同日に発行した
-- ので実質は不定だった。画面によって並びが違って見えるのを止める。
--
-- 並びは施設側で決めたもの。名簿にも、立替の選択肢にも、貸切時間の表にも、
-- 同じ順を使う（getProfiles を通る場所はすべて）。

alter table profiles add column if not exists sort_order smallint not null default 99;

comment on column profiles.sort_order is
  'メンバーを並べる順。小さいほど先。画面ごとに並びが変わらないようにするためのもの。';

update profiles set sort_order = v.n
  from (values
    ('wakata',     1),
    ('ide',        2),
    ('nishibara',  3),
    ('watanabe',   4),
    ('morimatsu',  5),
    ('koga',       6)
  ) as v(login_id, n)
 where profiles.login_id = v.login_id;

create index if not exists profiles_sort_idx on profiles (sort_order, login_id);
