-- 0079 店長もアカウント管理（店主指示 2026-11-10「アカウント管理、店長からもできるようにしておいて」）
--
-- 範囲：店長はスタッフ・事務・閲覧のみ のアカウントだけ。
--   ・オーナー・店長の行は変えられない／消せない
--   ・誰かをオーナー・店長にすることもできない（発行・ロール変更とも）
-- アプリの API はサービスロールで書くので API 側（src/lib/account-scope.ts）で止め、
-- ここでは、店長がアプリを通さずに Supabase を直接叩いた場合（RLS の profiles_write は account.write だけを見る）を止める。

insert into role_permissions (role, permission)
select 'manager', 'account.write'
where not exists (select 1 from role_permissions where role = 'manager' and permission = 'account.write');

create or replace function public.profiles_guard_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor user_role;
begin
  -- サービスロール（アプリのサーバー・移行スクリプト）は API 側で範囲を確かめている
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  select role into actor from profiles where id = auth.uid();
  if actor = 'owner' then
    return coalesce(new, old);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.role in ('owner', 'manager') then
    raise exception 'オーナー・店長のアカウントはオーナーだけが変更できます' using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.role in ('owner', 'manager') then
    raise exception 'オーナー・店長にできるのはオーナーだけです' using errcode = '42501';
  end if;
  return coalesce(new, old);
end
$$;

drop trigger if exists profiles_guard_scope on profiles;
create trigger profiles_guard_scope
  before insert or update or delete on profiles
  for each row execute function public.profiles_guard_scope();
