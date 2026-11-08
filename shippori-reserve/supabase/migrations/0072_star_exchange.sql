-- 0072 達成貢献⭐の交換（店主指定 2026-11-09）
--
--   ⭐は今までどおり計算で出す（売上目標を達成した日 × その日の確定シフト）。表には持たない。
--   ここに持つのは「交換の申請と、交換した記録」だけ。使える⭐＝累計 − 交換済み − 申請中。
--
--   流れ：本人が「交換を申請」→ 店長（またはオーナー）が渡したら「交換しました」→ ⭐100が減る
--   ★何と交換するかは、まだアプリに出さない（店主指示「まだ掲載しないで」）。
--     settings.star_exchange_enabled が true になるまで、申請のボタンも出さない（既定は false）。
--
--   書き込みはサーバーの操作（server action）だけが行う。本人は自分の行だけ、店長・オーナーは全員の行を読める。

create table if not exists star_redemptions (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id),
  stars         integer not null default 100 check (stars > 0 and stars <= 1000),
  status        text not null default 'requested' check (status in ('requested', 'done', 'cancelled')),
  requested_at  timestamptz not null default now(),
  done_by       uuid references profiles(id),
  done_at       timestamptz,
  check ((status = 'done') = (done_at is not null))
);
create index if not exists star_redemptions_profile on star_redemptions (profile_id);
-- 1人が同時に出せる申請は1つ
create unique index if not exists star_redemptions_one_open on star_redemptions (profile_id) where status = 'requested';

alter table star_redemptions enable row level security;

drop policy if exists star_redemptions_select on star_redemptions;
create policy star_redemptions_select on star_redemptions for select to authenticated
  using (profile_id = auth.uid() or has_permission('shift.write'));
-- insert / update / delete の方針は置かない（サーバーの管理キーだけが書く）

insert into settings (key, value) values ('star_exchange_enabled', 'false'::jsonb)
on conflict (key) do nothing;

comment on table star_redemptions is '達成貢献⭐の交換の申請と記録。使える⭐＝累計（計算）− 交換済み − 申請中';
