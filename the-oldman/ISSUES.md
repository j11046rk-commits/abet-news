# ISSUES — 既知の課題

各フェーズ完了時に追記する。

## Phase 0（SPEC / DESIGN）

- [x] 元プロンプト §5 は「Vercel にデプロイ」、§9 は「Cloudflare Pages にデプロイ済み」で矛盾。**Vercel を採用**（SPEC §5 に記載）。Cloudflare へ載せる場合の差分は HANDOFF に記す
- [ ] フォントは Google Fonts（`next/font/google`）から取得する。オフライン環境でビルドする場合はフォールバックが必要

## Phase 1（Supabase スキーマ）

- [x] Postgres 16 のローカルインスタンスで 5本のマイグレーションを適用し、RLS の挙動（member の台帳 insert 拒否 / 無効アカウントの読み取り 0件 / 自己ロール昇格の無効化 / セッション → 台帳の自動起票）を実測で確認済み
- [ ] 固定費の当月自動計上はトリガでも cron でもなく、`/ledger` を開いた owner が「計上する」を押す方式。`pg_cron` を入れられるなら自動化したい
- [ ] `players.name` に unique を張った。同姓同名のゲストが来た場合は「山田(2)」のように運用で回避する必要がある
- [ ] 最初のオーナー1人だけは SQL で作る必要がある（`supabase/README.md`）。ブートストラップ用の CLI スクリプトがあると親切

## Phase 2（Next.js シェル / 認証 / トークン）

- [x] `npx next build` 通過。`/login` を 375px で目視確認（Bodoni Moda / 真鍮ヘアライン / 下線のみの入力欄 / グレイン）
- [ ] この環境には Supabase も Docker も無いため、**ログインの往復（signInWithPassword）は実測できていない**。Supabase プロジェクト作成後に要確認
- [ ] `must_change_password` の強制リダイレクトは `(app)/layout.tsx` で行っている。middleware でやると全リクエストに profiles の問い合わせが増えるため
- [ ] ログイン失敗メッセージは ID の存在有無を区別しない共通文言にした（列挙攻撃対策）
