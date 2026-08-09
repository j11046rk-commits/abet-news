import type { MetadataRoute } from "next";

/**
 * ホーム画面に追加したとき、Safari の枠なしで開くための宣言。
 * 毎日開く9人のための道具なので、アドレスバーに場所を取らせない。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "しっぽり亭 予約管理",
    short_name: "しっぽり管理",
    description: "しっぽり亭 店舗予約管理",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#111726",
    theme_color: "#111726",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
