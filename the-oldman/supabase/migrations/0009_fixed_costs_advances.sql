-- The Oldmans — 0009 固定費の自動起票・立替メモ・目標額の分母の是正
--
-- 3つのことをまとめて直す。
--
-- 1) 固定費を「家賃」「共益費」の2件に絞り、計上日が来たら自動で台帳に載せる。
--    これまでは owner が台帳を開いて「計上する」を押す方式だったが、押し忘れると
--    その月の支出が丸ごと抜ける。0008 で pg_cron が動くことは確認済みなので、
--    同じ仕組みに寄せる。
--
-- 2) 立替メモ。備品などを個人が立て替えたとき、誰が・何に・いくら・いつ精算するかを
--    残す。台帳（施設の収支）とは別物なので別テーブルにする。立替そのものは
--    施設の収支を動かさない — 動くのは精算したときで、それは台帳に記帳される。
--
-- 3) 月次目標の分母の是正。
--    月次目標（¥100,000）は「家賃＋共益費＋水道光熱でおよそ10万円かかるから、
--    レーキでそれを賄う」という意味の数字である。ところがダッシュボードは
--    達成額に v_monthly_summary.net_yen（全収入 − 全支出）を使っていた。これだと
--      - 出資（¥1,200,000 など）が達成額に混ざって、一晩で目標達成に見える
--      - 家賃を支出計上した分だけ達成額が下がり、目標10万円のために20万円必要になる
--    という二重の誤りが出る。運営収入（出資を除いた収入）だけを見るように直す。

-- ── 1) 固定費 ───────────────────────────────────────────────────────────

alter table fixed_costs add column if not exists category text not null default 'other';

comment on column fixed_costs.category is
  '台帳に起票するときのカテゴリ。EXPENSE_CATEGORIES の値と対応する。';

update fixed_costs set category = 'rent' where name = '家賃';

delete from fixed_costs where name not in ('家賃', '共益費');

insert into fixed_costs (name, amount_yen, billing_day, is_active, category)
select '家賃', 80000, 27, true, 'rent'
where not exists (select 1 from fixed_costs where name = '家賃');

insert into fixed_costs (name, amount_yen, billing_day, is_active, category)
select '共益費', 0, 27, true, 'common_fee'
where not exists (select 1 from fixed_costs where name = '共益費');

-- 台帳の行がどの固定費から起きたのかを持たせる。
-- 同じ固定費・同じ日付では1行しか立たない（何度動かしても増えない）。
alter table ledger_entries
  add column if not exists fixed_cost_id uuid references fixed_costs(id) on delete set null;

-- 「計上する」ボタンで手動起票された既存の行を、対応する固定費に結び付ける。
-- 起票日の作り方は手動時と同じ（当月 + billing_day）なので、日付と名前で一意に当たる。
-- 同じ日に同じ名前の行が複数ある場合は最も古い1行だけを紐づけ、残りは手入力として残す。
update ledger_entries e
   set fixed_cost_id = c.id
  from fixed_costs c
 where e.fixed_cost_id is null
   and e.session_id is null
   and e.direction = 'expense'
   and e.memo = c.name
   and e.id = (
     select id from ledger_entries x
      where x.memo = c.name and x.entry_date = e.entry_date
        and x.direction = 'expense' and x.fixed_cost_id is null
      order by x.created_at
      limit 1
   );

create unique index if not exists ledger_entries_fixed_cost_key
  on ledger_entries (fixed_cost_id, entry_date)
  where fixed_cost_id is not null;

comment on column ledger_entries.fixed_cost_id is
  '固定費マスタから自動起票された行。金額を直すときは台帳ではなくマスタ側を直す。';

-- 計上日が到来した固定費を当月ぶんだけ起票する。
-- security definer：cron（postgres）からも、必要なら画面からも同じ結果になるように。
create or replace function public.post_due_fixed_costs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Tokyo')::date;
  n integer;
begin
  insert into ledger_entries
    (entry_date, direction, category, amount_yen, memo, fixed_cost_id, created_by)
  select
    make_date(extract(year from today)::int, extract(month from today)::int, c.billing_day),
    'expense',
    c.category,
    c.amount_yen,
    c.name,
    c.id,
    null
  from fixed_costs c
  where c.is_active
    and c.amount_yen > 0                     -- 金額未設定のものは載せない
    and c.billing_day <= extract(day from today)::int
  on conflict (fixed_cost_id, entry_date) where fixed_cost_id is not null
    do nothing;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.post_due_fixed_costs() from public, anon;
grant execute on function public.post_due_fixed_costs() to authenticated;

-- 毎日 00:10 JST（= 15:10 UTC 前日）に走らせる。
-- 月初に前月ぶんが漏れることはない：計上日が来た月のうちに毎日試行するため。
do $$
begin
  perform cron.unschedule('the-oldman-fixed-costs')
   where exists (select 1 from cron.job where jobname = 'the-oldman-fixed-costs');

  perform cron.schedule(
    'the-oldman-fixed-costs',
    '10 15 * * *',
    $cron$select public.post_due_fixed_costs();$cron$
  );
end $$;

-- 自動起票された行は台帳から直接いじらせない。
-- セッション由来のレーキ行と同じ扱い（金額はマスタ側で直す）。
drop policy if exists ledger_update on ledger_entries;
drop policy if exists ledger_delete on ledger_entries;

create policy ledger_update on ledger_entries
  for update to authenticated
  using (public.is_active_user() and session_id is null and fixed_cost_id is null)
  with check (public.is_active_user() and session_id is null and fixed_cost_id is null);

create policy ledger_delete on ledger_entries
  for delete to authenticated
  using (public.is_active_user() and session_id is null and fixed_cost_id is null);

-- ── 2) 立替メモ ─────────────────────────────────────────────────────────

create table if not exists advances (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete restrict,
  title text not null check (length(btrim(title)) > 0),
  amount_yen integer not null check (amount_yen > 0),
  due_on date,
  settled_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists advances_open_idx on advances (settled_at, due_on);

comment on table advances is
  '個人が立て替えた費用のメモ。誰に返すのかを忘れないための一覧で、施設の収支そのものではない。';

alter table advances enable row level security;

create policy advances_select on advances
  for select to authenticated using (public.is_active_user());

-- 立替は6人全員が起票・編集・削除できる。台帳と同じ考え方で、
-- 記録を一人に属人化させない。
create policy advances_insert on advances
  for insert to authenticated with check (public.is_active_user());

create policy advances_update on advances
  for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

create policy advances_delete on advances
  for delete to authenticated using (public.is_active_user());

grant select, insert, update, delete on advances to authenticated;

-- ── 3) 運営収入を月次サマリに足す ───────────────────────────────────────

drop view if exists v_monthly_summary;

create view v_monthly_summary
with (security_invoker = on) as
with m as (
  select
    to_char(entry_date, 'YYYY-MM') as ym,
    coalesce(sum(amount_yen) filter (where direction = 'income'),  0)::integer as income_yen,
    -- 出資・追加拠出は資本であって、その月に稼いだ金ではない。
    -- 月次目標（レーキで家賃を賄えたか）はこちらで測る。
    coalesce(sum(amount_yen) filter (
      where direction = 'income' and category <> 'investment'), 0)::integer   as operating_income_yen,
    coalesce(sum(amount_yen) filter (where direction = 'expense'), 0)::integer as expense_yen
  from ledger_entries
  group by 1
)
select
  ym,
  income_yen,
  operating_income_yen,
  expense_yen,
  (income_yen - expense_yen)::integer as net_yen,
  sum(income_yen - expense_yen) over (
    order by ym rows between unbounded preceding and current row
  )::integer as balance_yen
from m;

comment on view v_monthly_summary is
  '年月(JST基準の entry_date)ごとの収入合計・運営収入（出資を除く）・支出合計・当月収支・累計残高。';

grant select on v_monthly_summary to authenticated;
