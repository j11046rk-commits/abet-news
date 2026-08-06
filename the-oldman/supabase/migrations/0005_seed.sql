-- The Oldmans — 0005 seed
-- 施設設定・固定費・参加者マスタ・過去3ヶ月のダミーセッション。
-- アカウント（auth.users / profiles）はオーナーが管理画面から発行するため、ここでは作らない。
-- 実行は postgres ロール想定（RLS はバイパスされる）。

-- ── 施設設定 ────────────────────────────────────────────────────────────
insert into settings (id, facility_name, monthly_target_yen, owner_count, rake_rule)
values (
  true,
  'The Oldmans',
  100000,
  6,
  'キャッシュゲームはポット5%（上限 ¥1,000）。トーナメントは参加費の10%を運営費として徴収する。'
)
on conflict (id) do nothing;

-- ── 固定費 ──────────────────────────────────────────────────────────────
insert into fixed_costs (name, amount_yen, billing_day, is_active) values
  ('家賃',   80000, 27, true),
  ('光熱費', 15000,  5, true),
  ('通信費',  5000,  5, true)
on conflict do nothing;

-- ── 参加者マスタ ────────────────────────────────────────────────────────
-- オーナー6名 + 常連ゲスト。アカウント発行時に profile_id を紐づける。
insert into players (name) values
  ('サンチャゴ'),
  ('マノーリン'),
  ('ペドリコ'),
  ('マルティン'),
  ('ロヘリオ'),
  ('ペリコ'),
  ('ゲスト・岡'),
  ('ゲスト・古賀'),
  ('ゲスト・山本'),
  ('ゲスト・重松')
on conflict (name) do nothing;

-- ── 過去3ヶ月のダミーセッションと支出 ──────────────────────────────────
do $$
declare
  d date;
  today date := (now() at time zone 'Asia/Tokyo')::date;
  start_d date := (date_trunc('month', today) - interval '2 months')::date;
  sid uuid;
  rake integer;
  gt game_type;
  seat integer;
  n integer;
  pid uuid;
  m date;
begin
  -- セッション：金・土・日を中心に、平均 ¥8,400 前後のレーキ
  for d in select generate_series(start_d, today, interval '1 day')::date loop
    continue when extract(dow from d) not in (0, 5, 6);
    -- 週末でも 2 割は開催なし
    continue when (extract(doy from d)::int % 5) = 0;

    gt := case when (extract(doy from d)::int % 7) = 3 then 'tournament'::game_type
               else 'cash'::game_type end;
    rake := case gt
              when 'tournament' then 9000 + (extract(doy from d)::int % 9) * 700
              else 5200 + (extract(doy from d)::int % 11) * 600
            end;

    insert into sessions (started_at, ended_at, game_type, rake_yen, note)
    values (
      ((d::text || ' 20:00')::timestamp at time zone 'Asia/Tokyo'),
      ((d::text || ' 20:00')::timestamp at time zone 'Asia/Tokyo') + interval '4 hours',
      gt,
      rake,
      null
    )
    returning id into sid;

    -- 参加者を 4〜7 名
    seat := 4 + (extract(doy from d)::int % 4);
    n := 0;
    for pid in
      select id from players order by md5(id::text || d::text) limit seat
    loop
      insert into session_players (session_id, player_id) values (sid, pid)
      on conflict do nothing;
      n := n + 1;
    end loop;
  end loop;

  -- 固定費の過去計上（当月ぶんを除く2ヶ月）
  for m in select generate_series(start_d, date_trunc('month', today)::date - interval '1 month', interval '1 month')::date loop
    insert into ledger_entries (entry_date, direction, category, amount_yen, memo)
    values
      ((m + interval '26 days')::date, 'expense', 'rent',      80000, '家賃'),
      ((m + interval '4 days')::date,  'expense', 'utilities', 15000, '光熱費'),
      ((m + interval '4 days')::date,  'expense', 'other',      5000, '通信費');
  end loop;

  -- 備品・ドリンクの雑多な出入り
  insert into ledger_entries (entry_date, direction, category, amount_yen, memo) values
    ((start_d + interval '9 days')::date,  'expense', 'supplies', 12800, 'カードとチップの補充'),
    ((start_d + interval '38 days')::date, 'expense', 'supplies',  6400, '葉巻ケースの湿度計'),
    ((start_d + interval '12 days')::date, 'income',  'drink',     4200, 'ドリンク実費'),
    ((start_d + interval '41 days')::date, 'income',  'drink',     3800, 'ドリンク実費'),
    ((start_d + interval '20 days')::date, 'income',  'guest_fee', 6000, 'ゲストフィー 3名');
end $$;
