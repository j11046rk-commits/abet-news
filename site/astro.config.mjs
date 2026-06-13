// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// 公開URLの「正」。独自ドメイン接続後もこのままでOK。
// （ドメインを変える場合はここ1か所を直す）
export default defineConfig({
  // 既定は本番ドメイン（ルート配信）。プレビュー配信用に環境変数で上書きできる。
  // 例: GitHub Pages プレビュー → SITE_URL / BASE_PATH を渡す（本番は未設定でOK）。
  site: process.env.SITE_URL || 'https://shipporitei.co.jp',
  base: process.env.BASE_PATH || '/',
  integrations: [sitemap()],
  build: {
    // CSS をインライン化しすぎず、キャッシュしやすい構成に
    assets: 'assets',
  },
  // 画像最適化（遅延読み込み＋圧縮）は Astro 標準の <Image> を利用
});
