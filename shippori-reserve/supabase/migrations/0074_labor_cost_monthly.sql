-- 0074 月の人件費の合計（店主指示 2026-11-09「人時売上からの推定じゃなく、実際の人件費率を。
--      全体の合計なら出していい。個人の人件費はちゃんと隠して」）
--
--   ・持つのは「その月の店全体の人件費の合計（円）」1つだけ。誰にいくら払ったかは持たない・受け取らない
--   ・人件費率 ＝ この合計 ÷ その月の税抜売上。店舗評価（全員が見る）には率だけを出す
--   ・入れるのはオーナー（画面）。書き込みはサーバーの操作だけ（書き込みの方針は置かない）

create table if not exists labor_cost_monthly (
  ym          text primary key check (ym ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  total_yen   integer not null check (total_yen between 0 and 100000000),
  note        text check (note is null or length(note) <= 200),
  updated_by  uuid references profiles(id),
  updated_at  timestamptz not null default now()
);

alter table labor_cost_monthly enable row level security;
drop policy if exists labor_cost_monthly_select on labor_cost_monthly;
create policy labor_cost_monthly_select on labor_cost_monthly for select to authenticated using (true);

comment on table labor_cost_monthly is '月の店全体の人件費の合計だけ（個人の額は持たない）。人件費率＝合計÷税抜売上';
