-- The Oldman — 0010 ほしい物リスト
--
-- 「これを置きたい」を思いついたときに書き留めておく場所。買う判断は6人でするので、
-- 起票者・名称・金額・備考だけを持たせ、承認フローは作らない。
-- 商品ページのスクリーンショットを貼れると話が早いので、画像を1枚まで添付できる。
--
-- 画像は非公開バケットに置き、閲覧は署名URLで行う。会員制の施設なので、
-- URL を知っている誰でも見られる状態にはしない。

create table if not exists wishlist_items (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) > 0),
  amount_yen integer check (amount_yen is null or amount_yen >= 0),
  note text,
  -- バケット内のパス。null なら画像なし。
  image_path text,
  -- 買ったら閉じる。行は消さない（何をいくらで買ったかは残しておきたい）。
  bought_at timestamptz,
  created_by uuid not null references profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists wishlist_items_open_idx on wishlist_items (bought_at, created_at desc);

comment on table wishlist_items is
  'ほしい物リスト。誰が挙げたかを残すため created_by は必須。bought_at が入った行は購入済み。';

alter table wishlist_items enable row level security;

create policy wishlist_select on wishlist_items
  for select to authenticated using (public.is_active_user());

-- 台帳や立替と同じく、6人全員が書ける。他人が挙げたものにも手を入れられる
-- （「これ買った」を気づいた人が閉じられるようにするため）。
create policy wishlist_insert on wishlist_items
  for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid());

create policy wishlist_update on wishlist_items
  for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

create policy wishlist_delete on wishlist_items
  for delete to authenticated using (public.is_active_user());

grant select, insert, update, delete on wishlist_items to authenticated;

-- ── 画像の置き場 ───────────────────────────────────────────────────────
-- storage スキーマは Supabase 上にしか無い。ローカルの検証用DBでは黙って飛ばす。
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage スキーマが無いため、バケットの作成は飛ばした（ローカル検証）';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('wishlist', 'wishlist', false, 5242880,
          array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
  on conflict (id) do update
    set file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists wishlist_objects_select on storage.objects;
  drop policy if exists wishlist_objects_insert on storage.objects;
  drop policy if exists wishlist_objects_delete on storage.objects;

  create policy wishlist_objects_select on storage.objects
    for select to authenticated
    using (bucket_id = 'wishlist' and public.is_active_user());

  create policy wishlist_objects_insert on storage.objects
    for insert to authenticated
    with check (bucket_id = 'wishlist' and public.is_active_user());

  create policy wishlist_objects_delete on storage.objects
    for delete to authenticated
    using (bucket_id = 'wishlist' and public.is_active_user());
end $$;
