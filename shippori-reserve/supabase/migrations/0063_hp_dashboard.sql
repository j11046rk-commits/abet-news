-- 0063 HPのアクセス管理ダッシュボードを、店舗管理アプリのログインで見られるようにする（店主要望 2026-11-04）
--
-- これまで：shipporitei.jp/dashboard を合言葉1つで暗号化して公開していた。
-- これから：HPのビルド（毎時）が出来上がったダッシュボードをここへ送り、
--           店舗管理アプリにログインしている人だけが /hp-dashboard で見る。
--
-- 中身は集計だけ（GA4の訪問数・流入元と、予約の件数・比率）。個人情報は入らない。
-- 1行だけの表。RLS を有効にして方針を置かない＝画面やAPIからは直接読めない。
-- 読むのはサーバー（ログイン確認のあと service role で読む）だけ。
create table if not exists hp_dashboard (
  id         integer primary key default 1 check (id = 1),
  html       text not null,
  built_at   timestamptz,
  updated_at timestamptz not null default now()
);
alter table hp_dashboard enable row level security;
