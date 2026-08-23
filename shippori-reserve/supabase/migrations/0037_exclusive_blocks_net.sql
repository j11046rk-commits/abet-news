-- 0037 貸切の日はネット予約を受けない（DB側の最後の砦）
--
-- 貸切（is_exclusive・25名様〜のフロア一体利用）は、席が個別に埋まっていなくても
-- その日は店ごと押さえている。ところが空席判定はどこも is_exclusive を見ておらず、
-- 貸切の日でも予約ページが「◯空席あり」を出し、お客様が予約できてしまっていた。
-- 来店して初めて貸切だと分かる——店にとってもお客様にとっても一番まずい形。
--
-- アプリ側（src/lib/public-booking.ts の dayStatus）でも塞いだが、
-- net_reserve は「アプリを信用せず、DBが最後に拒否する」ための関数なので、
-- ここにも同じ判定を置く。
--
-- 差し込む場所は advisory lock を取ったすぐ後、NET_PAUSED の隣。
-- どちらも「席の空き以前に、その日はもう受けない」という同じ性質の判定なので。
--
-- 既存の合図と同じく例外で返す。予約ページ側は NET_FULL と同じ扱いにして
-- 「たった今この枠が埋まりました」と出す（貸切であることは外に出さない）。

do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'net_reserve';

  if v_src is null then
    raise exception 'net_reserve が見つかりません。0021〜0029 が適用されているか確認してください。';
  end if;

  -- 何度流しても同じ結果になるように
  if position('NET_EXCLUSIVE' in v_src) > 0 then
    raise notice '貸切の判定はすでに入っています。何もしません。';
    return;
  end if;

  -- 目印は 0027 で入った NET_PAUSED の判定ブロック。その直後に足す。
  if position('raise exception ''NET_PAUSED'';' in v_src) = 0 then
    raise exception 'net_reserve の中に NET_PAUSED の判定が見つかりません。定義が想定と違います。';
  end if;

  -- 差し込む前と後を、そのままの姿で書く（$old$ … $old$ で囲めば引用符も改行も素通し）。
  -- エスケープの積み木で組むと、読む人が「実際どういう文字列になるのか」を
  -- 頭の中で組み立てないと分からなくなる。ここは1文字違えば置換が外れる場所なので。
  v_new := replace(
    v_src,
$old$    raise exception 'NET_PAUSED';
  end if;$old$,
$new$    raise exception 'NET_PAUSED';
  end if;

  -- 貸切は店ごと押さえる予約。席の空きにかかわらずネットからは受けない。
  if exists (
    select 1 from reservations
     where biz_date = p_date
       and is_exclusive
       and status in ('tentative','confirmed','seated')
  ) then
    raise exception 'NET_EXCLUSIVE';
  end if;$new$
  );

  if v_new = v_src then
    raise exception '差し込みに失敗しました（置換が一致しませんでした）。';
  end if;

  execute v_new;
  raise notice '貸切の判定を net_reserve に追加しました。';
end $$;

-- 入ったことを確かめる
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'net_reserve'
       and position('NET_EXCLUSIVE' in pg_get_functiondef(p.oid)) > 0
  ) then
    raise exception 'net_reserve に貸切の判定が入っていません。';
  end if;
end $$;

-- 貸切の日を素早く引けるように（1日に何度も見る判定なので）
create index if not exists reservations_exclusive_idx
  on reservations (biz_date)
  where is_exclusive and status in ('tentative','confirmed','seated');
