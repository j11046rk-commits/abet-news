// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// 公開URLの「正」。独自ドメイン接続後もこのままでOK。
// （ドメインを変える場合はここ1か所を直す）
export default defineConfig({
  site: 'https://shipporitei.co.jp',
  integrations: [sitemap()],
  build: {
    // CSS をインライン化しすぎず、キャッシュしやすい構成に
    assets: 'assets',
  },
  // 画像最適化（遅延読み込み＋圧縮）は Astro 標準の <Image> を利用
});
