-- The Oldmans — 0012 画像の置き場所を本人のフォルダに限る
--
-- 0010 では「アクティブな会員ならバケットに書ける」とだけ決めていた。
-- 画像の実体をブラウザから直接バケットへ上げる形に変えた（Server Action の
-- 本文上限 1MB に写真が引っかかるため）ので、パスの先頭が本人のIDであることを
-- ここでも要求する。誰かの名前のフォルダに置いていける状態を残さない。
--
-- 読み取りと削除は会員全員のまま。6人の共有リストなので、他人が挙げた品の
-- 画像も見えるべきだし、要らなくなった行を気づいた人が消せるべきである
-- （削除を本人に限ると、消された行の画像だけが誰にも辿れず残る）。

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage スキーマが無いため飛ばした（ローカル検証）';
    return;
  end if;

  drop policy if exists wishlist_objects_insert on storage.objects;

  create policy wishlist_objects_insert on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'wishlist'
      and public.is_active_user()
      and (storage.foldername(name))[1] = auth.uid()::text
    );
end $$;
