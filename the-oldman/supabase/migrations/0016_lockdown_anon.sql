-- The Oldmans — 0016 未ログインの締め出し（多層防御）
--
-- すべてのテーブルは RLS 有効で、ポリシーは authenticated にしか与えていない。
-- つまり anon は今も何も読めないのだが、それは「ポリシーが無いから」であって
-- 「権限が無いから」ではない。Supabase の既定では anon にもテーブル権限
-- (GRANT ALL) が配られているため、将来ポリシーを1つ書き間違えただけで
-- 外に漏れる構図になっている。6人以外に見せないサイトなので、
-- anon からはテーブル・ビュー・シーケンスの権限そのものを剥がしておく。
--
-- ログイン前のブラウザが使うのは Supabase Auth (GoTrue) だけで、
-- public スキーマには触れない。剥がしても動作は変わらない。

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- 今後作るテーブルにも anon への既定権限を配らない
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
