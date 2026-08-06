import type { MetadataRoute } from "next";

/**
 * ホーム画面に追加したとき、ブラウザの枠なしのアプリとして開くための宣言。
 * 毎日開く6人のための画面なので、Safari のバーに場所を取らせない。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The Oldmans",
    short_name: "Oldmans",
    description: "会員制プライベートクラブの運営ダッシュボード",
    start_url: "/",
    display: "standalone",
    background_color: "#0C0D0F",
    theme_color: "#0C0D0F",
    icons: [
      { src: "/images/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/images/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
