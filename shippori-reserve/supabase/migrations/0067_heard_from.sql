-- 0067 「何を見てご連絡いただいたか」（店主要望 2026-11-07）
--
-- 11/6〜11/7 に団体の電話予約（25名・25名・30名など）が続けて入ったが、
-- 電話の予約はどこで店を知ったかが残らず、HPのアクセス解析とつなげられなかった。
-- 受けたスタッフが1タップで残せる欄。任意（聞けなかったら空のまま）。
-- 中身は決まった選択肢のキーだけ（自由記述にしない＝集計できる・個人情報が入らない）。
alter table reservations
  add column if not exists heard_from text
    check (heard_from is null or heard_from in (
      'gmap',      -- Googleマップ
      'search',    -- Google・Yahoo などの検索
      'hp',        -- ホームページ
      'instagram', -- Instagram
      'line',      -- 公式LINE（配信を見て など）
      'ai',        -- ChatGPT などのAI
      'repeat',    -- 前に来たことがある
      'referral',  -- 知り合い・会社の人の紹介
      'flyer',     -- チラシ・看板・店の前
      'other'      -- その他
    ));

comment on column reservations.heard_from is '何を見てご連絡いただいたか（電話・スタッフ入力の予約で、受けたスタッフが選ぶ。任意）';
