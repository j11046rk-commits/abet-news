-- 0041 LINEと予約を結びつける（LIFF）
--
-- 目的は2つ。
--   ① 予約したお客様と、公式LINEの友だちを**同一人物として**結びつける
--   ② 結びついたお客様に、確定連絡・前日リマインド・キャンセル受付を届ける
--
-- 友だち追加**だけ**では紐づかない。届くのは「Uから始まるIDの人が友だちになった」
-- という事実だけで、予約フォームに名前を書いた誰かと同じ人だという保証がない。
-- 予約している最中にLINEでログインしてもらう（LIFF）から、初めて結びつく。
--
-- ★このIDは個人情報として扱う。
--   氏名・電話番号と同じ13か月で消す（purge_reservation_pii に足す）。
--   友だちの一覧（line_friends）は、ブロックされるまで残す——
--   こちらは「予約の記録」ではなく「連絡してよい相手の名簿」なので、性質が違う。

alter table reservations add column if not exists line_user_id text;

comment on column reservations.line_user_id is
  'この予約をしたお客様のLINEユーザーID（LIFFでログインしたときだけ入る）。個人情報';

-- 同じ人の予約をまとめて引くため（「3か月来ていない人」を出すのはこの索引の上）
create index if not exists reservations_line_user_idx
  on reservations (line_user_id, biz_date desc)
  where line_user_id is not null;

-- ── 公式LINEの友だち ────────────────────────────────
create table if not exists line_friends (
  line_user_id    text primary key,
  display_name    text,
  followed_at     timestamptz not null default now(),
  -- ブロック（友だち解除）された時刻。行は消さない——
  -- 消すと「一度も友だちでなかった人」と区別がつかなくなり、
  -- 送ってはいけない相手にまた送る事故が起きる。
  unfollowed_at   timestamptz,
  last_message_at timestamptz,
  updated_at      timestamptz not null default now()
);

comment on table line_friends is
  '公式LINEの友だち。webhookのfollow/unfollowで更新する。unfollowed_atが入っている人には送らない';

alter table line_friends enable row level security;
revoke all on line_friends from anon, authenticated;

-- 読むのは店の中の人だけ（誰が友だちかは店の資産であって、公開情報ではない）
grant select on line_friends to authenticated;
drop policy if exists line_friends_select on line_friends;
create policy line_friends_select on line_friends
  for select to authenticated using (is_active_user());

-- 書き込みは webhook（service role）だけ。画面からは触らせない。

-- ── 保存期間に合わせる ────────────────────────────────
-- 予約に付いたLINEのIDも、氏名・電話番号と同じ13か月で消す。
-- 「消しました」と言うなら、連絡先の一種であるこれも消えていないと嘘になる。
create or replace function public.purge_reservation_pii(p_months integer default 13)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update reservations
     set customer_name = '（保存期間経過）',   -- NOT NULL かつ空文字禁止なので置き換える
         customer_kana = null,
         phone         = null,
         memo          = null,
         allergy       = null,
         invoice_name  = null,
         source_detail = null,
         line_user_id  = null
   where biz_date < (now() at time zone 'Asia/Tokyo')::date - make_interval(months => p_months)
     and customer_name <> '（保存期間経過）';
  get diagnostics n = row_count;
  insert into audit_logs (actor, action, target_table, target_id, before, after)
  values (null, 'reservations.purge', 'reservations', null, null,
          jsonb_build_object('rows', n, 'months', p_months));
  return n;
end;
$$;
revoke execute on function public.purge_reservation_pii(integer) from public, anon, authenticated;

-- ── ネット予約にLINEのIDを持たせる ──────────────────────
-- 0026 の net_reserve に引数を1つ足しただけ。席の判定は1文字も変えていない。
-- **引数の数が変わるので別の関数として増える**（PostgRESTは引数名で呼び分ける）。
-- 旧い形も残るので、配り替えの途中で古い画面が動いていても予約が壊れない。
create or replace function public.net_reserve(
  p_date      date,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_party     integer,
  p_name      text,
  p_kana      text,
  p_phone     text,
  p_memo      text,
  p_seat_note text,
  p_line_user_id text
) returns table (id uuid, reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day    business_days%rowtype;
  v_found  boolean;
  v_busy   boolean;
  v_cap    integer;
  v_guests integer;
  v_unit   seat_units%rowtype;
  v_used   integer;
begin
  if p_party is null or p_party < 1 or p_party > 8 then
    raise exception 'NET_PARTY';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'NET_NAME';
  end if;

  perform pg_advisory_xact_lock(hashtext('net-reserve-' || p_date::text));

  select * into v_day from business_days where biz_date = p_date;
  v_found := found;

  if v_found and v_day.is_closed then
    raise exception 'NET_CLOSED';
  end if;

  v_busy := case when v_found then v_day.is_busy
                 else extract(dow from p_date) in (5, 6) end;

  if v_found and v_day.mode = 'event' then
    v_cap := coalesce(v_day.event_capacity, 36);
    select coalesce(sum(party_size), 0) into v_guests
      from reservations
     where biz_date = p_date and status in ('tentative', 'confirmed', 'seated');
    if v_guests + p_party > v_cap then
      raise exception 'NET_FULL';
    end if;
  elsif p_seat_note is not null and p_seat_note <> '指定なし' then
    select * into v_unit from seat_units where name = p_seat_note and is_active;
    if not found then
      raise exception 'NET_SEAT_UNKNOWN';
    end if;
    if v_busy and p_party <= 3 and not v_unit.is_shared then
      raise exception 'NET_BUSY_RULE';
    end if;
    if v_unit.is_shared then
      select coalesce(sum(party_size), 0) into v_used
        from reservations
       where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
         and seat_note is not null
         and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'));
      -- 席ボード（飛び込み）は予約と重なっている可能性があるので大きい方を採る
      v_used := greatest(
        v_used,
        coalesce((select occupied from seat_board where biz_date = p_date and key = 'C'), 0),
        coalesce((select sum(occupied) from seat_board
                   where biz_date = p_date and key ~ '^C[0-9]+$'), 0));
      if v_used + p_party > v_unit.capacity then
        raise exception 'NET_FULL';
      end if;
    else
      if exists (
        select 1 from reservations
         where biz_date = p_date and status in ('tentative', 'confirmed', 'seated')
           and seat_note is not null
           and p_seat_note = any(string_to_array(replace(seat_note, ' ', ''), '＋'))
      ) or exists (
        select 1 from seat_board
         where biz_date = p_date and key = p_seat_note and occupied > 0
      ) then
        raise exception 'NET_FULL';
      end if;
    end if;
  end if;

  return query
  insert into reservations
    (biz_date, starts_at, ends_at, party_size, customer_name, customer_kana, phone,
     source, source_detail, status, seat_note, memo, line_user_id)
  values
    (p_date, p_starts_at, p_ends_at, p_party, btrim(p_name), nullif(btrim(coalesce(p_kana, '')), ''),
     p_phone, 'web_form', 'ネット予約', 'confirmed', p_seat_note,
     nullif(btrim(coalesce(p_memo, '')), ''),
     nullif(btrim(coalesce(p_line_user_id, '')), ''))
  returning reservations.id, reservations.reference;
end;
$$;

revoke execute on function public.net_reserve(
  date, timestamptz, timestamptz, integer, text, text, text, text, text, text
) from public, anon, authenticated;
