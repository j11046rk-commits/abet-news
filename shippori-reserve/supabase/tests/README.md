# DBの検証

**捨ててよいデータベースでだけ流してください。** テスト用の予約とスタッフを実際に書き込みます。
本番の Supabase プロジェクトでは絶対に実行しないこと。

確かめているのは、アプリのコードを1行も信用しなくても守られてほしいことだけです。

| # | 確かめていること |
|---|---|
| 1 | 未ログイン（anon）は予約を1件も読めない |
| 2 | スタッフは予約を登録でき、受付番号と営業日の行が自動で埋まる（金曜は25:00閉店） |
| 3 | 流入元「オーナー直接」は、誰経由かが無いと保存できない |
| 4 | キャンセルは理由が無いと保存できない。理由を書くと日時が刻まれる |
| 5 | 一般スタッフは自分のロールを owner に書き換えられない |
| 6 | 一般スタッフは受付番号のカウンタを直接触れない |
| 7 | 閲覧のみ（viewer）は予約を読めるが登録できない |
| 8 | 閲覧のみは営業日を変更できない |
| 9 | イベント営業日は定員が無いと保存できない。残定員が正しく出る |
| 10 | 予約の変更が監査ログに残る |
| 11 | 流入元別の集計が引ける |

## ローカルの PostgreSQL で流す

Supabase そのものは要りません。`auth.users` と `auth.uid()` だけを模した殻を先に入れます。

```bash
# 16 以上の PostgreSQL を、捨ててよい場所に立てる
export PGDATA=/var/tmp/pgdata-shippori
initdb -D "$PGDATA" -A trust -U postgres
pg_ctl -D "$PGDATA" -o "-k /var/tmp -p 55432 -c listen_addresses=" -l "$PGDATA/log" start

export PGHOST=/var/tmp PGPORT=55432 PGUSER=postgres
psql -c "create database shippori;"
psql -d shippori -c 'create extension if not exists pgcrypto;' -f supabase/tests/00-local-shim.sql

for f in supabase/migrations/*.sql; do psql -d shippori -v ON_ERROR_STOP=1 -f "$f"; done
psql -d shippori -f supabase/tests/01-rls-and-constraints.sql
```

読み方：`ERROR` が出ている箇所は、**そこで拒否されるのが正解**です（各テストの直後に
「〜になるのが正解」と書いてあります）。逆に、拒否されるはずの行が `INSERT 0 1` で
通っていたら、そこが穴です。

## 本物の Supabase に対して確かめたいとき

`00-local-shim.sql` は要りません（`auth` スキーマは既にあります）。
ただし `01-...sql` はセッション変数でユーザーを装う作りなので、そのままでは通りません。
本番同等の確認は、実際にスタッフのアカウントでログインして画面から触るのが確実です。
