-- The Oldmans — 0014 チェックインに用途と人数を持たせる
--
-- これまでのチェックインは「誰がいるか」しか残らなかった。TOPで知りたいのは
-- そこから一歩先で、「いま何人いて、何をしているか」である。予約と同じ用途を
-- 選ばせて、連れの人数も入れられるようにする。
--
-- 予約と同じ enum を使う。同じ施設の同じ行為を、画面ごとに別の言葉で呼ばない。

alter table check_ins
  add column if not exists purposes reservation_purpose[] not null default '{}',
  add column if not exists headcount smallint not null default 1
    check (headcount between 1 and 30),
  add column if not exists memo text;

comment on column check_ins.purposes is
  '滞在の用途。予約と同じ enum。空配列は「用途を選ばずに入った」ことを表す。';
comment on column check_ins.headcount is
  '本人を含む人数。ゲストを連れて入ったときのために持つ。';
