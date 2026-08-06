-- The Oldman — 0003 RLS
-- 方針：
--   * 閲覧は「有効なアカウント全員」に開く。会計を一人に属人化させないため、台帳も member が読める。
--   * 書き込みは、自分が作ったものと、owner だけ。
--   * is_active = false のアカウントは、ログインできても一切書けない（読みも通さない）。
--   * アカウント発行・パスワードリセットは service role キーで実行するため RLS を通らない。

-- ── ヘルパ（security definer：profiles ポリシー内の再帰を避ける）────────
create or replace function public.current_profile_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from profiles p
  where p.id = auth.uid() and p.is_active
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() = 'owner', false)
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_role() is not null
$$;

revoke execute on function public.current_profile_role() from public, anon;
grant  execute on function public.current_profile_role() to authenticated;
grant  execute on function public.is_owner()             to authenticated;
grant  execute on function public.is_active_user()       to authenticated;

-- ── RLS 有効化 ──────────────────────────────────────────────────────────
alter table profiles        enable row level security;
alter table players         enable row level security;
alter table sessions        enable row level security;
alter table session_players enable row level security;
alter table reservations    enable row level security;
alter table ledger_entries  enable row level security;
alter table fixed_costs     enable row level security;
alter table settings        enable row level security;

-- ── profiles ────────────────────────────────────────────────────────────
-- 自分の行は is_active に関係なく読める（ログイン直後に自分の状態を判定するため）
create policy profiles_select_self on profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_select_all on profiles
  for select to authenticated
  using (public.is_active_user());

-- 本人は表示名のみ変更可。ロール・出資額・有効フラグの変更は owner のみ
create policy profiles_update_self on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_update_owner on profiles
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy profiles_insert_owner on profiles
  for insert to authenticated
  with check (public.is_owner());

-- ロール昇格の防止：本人による更新では role / investment_yen / is_active を変えられない
create or replace function public.guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_owner() then
    return new;
  end if;
  if new.id = auth.uid() then
    new.role           := old.role;
    new.investment_yen := old.investment_yen;
    new.is_active      := old.is_active;
    new.login_id       := old.login_id;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_self_update
  before update on profiles
  for each row execute function public.guard_profile_self_update();

-- ── players ─────────────────────────────────────────────────────────────
create policy players_select on players
  for select to authenticated using (public.is_active_user());

create policy players_insert on players
  for insert to authenticated with check (public.is_active_user());

create policy players_update on players
  for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

create policy players_delete_owner on players
  for delete to authenticated using (public.is_owner());

-- ── sessions ────────────────────────────────────────────────────────────
create policy sessions_select on sessions
  for select to authenticated using (public.is_active_user());

create policy sessions_insert on sessions
  for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid());

create policy sessions_update on sessions
  for update to authenticated
  using (public.is_active_user() and (created_by = auth.uid() or public.is_owner()))
  with check (public.is_active_user() and (created_by = auth.uid() or public.is_owner()));

create policy sessions_delete on sessions
  for delete to authenticated
  using (public.is_active_user() and (created_by = auth.uid() or public.is_owner()));

-- ── session_players（親セッションの権限に従う）──────────────────────────
create policy session_players_select on session_players
  for select to authenticated using (public.is_active_user());

create policy session_players_write on session_players
  for all to authenticated
  using (
    public.is_active_user() and exists (
      select 1 from sessions s
      where s.id = session_id and (s.created_by = auth.uid() or public.is_owner())
    )
  )
  with check (
    public.is_active_user() and exists (
      select 1 from sessions s
      where s.id = session_id and (s.created_by = auth.uid() or public.is_owner())
    )
  );

-- ── reservations ────────────────────────────────────────────────────────
create policy reservations_select on reservations
  for select to authenticated using (public.is_active_user());

create policy reservations_insert on reservations
  for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid());

create policy reservations_update on reservations
  for update to authenticated
  using (public.is_active_user() and (created_by = auth.uid() or public.is_owner()))
  with check (public.is_active_user() and (created_by = auth.uid() or public.is_owner()));

create policy reservations_delete on reservations
  for delete to authenticated
  using (public.is_active_user() and (created_by = auth.uid() or public.is_owner()));

-- ── ledger_entries（閲覧は全員 / 編集は owner）──────────────────────────
create policy ledger_select on ledger_entries
  for select to authenticated using (public.is_active_user());

-- 台帳への手入力は owner のみ。member がセッションを記録したときの
-- レーキ行は 0004 の security definer トリガが起票するため、この制限に触れない。
-- ※ この3つのポリシーは 0006 で差し替え、6人全員が記帳・編集できるようにしている。
create policy ledger_insert_owner on ledger_entries
  for insert to authenticated with check (public.is_owner());

create policy ledger_update_owner on ledger_entries
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy ledger_delete_owner on ledger_entries
  for delete to authenticated using (public.is_owner());

-- ── fixed_costs / settings（閲覧は全員 / 編集は owner）──────────────────
create policy fixed_costs_select on fixed_costs
  for select to authenticated using (public.is_active_user());

create policy fixed_costs_write_owner on fixed_costs
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy settings_select on settings
  for select to authenticated using (public.is_active_user());

create policy settings_write_owner on settings
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- ── 明示的な grant（anon には一切与えない）──────────────────────────────
revoke all on all tables in schema public from anon;

grant select, insert, update, delete on
  profiles, players, sessions, session_players, reservations,
  ledger_entries, fixed_costs, settings
to authenticated;
