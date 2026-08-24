import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorker from "@/components/ServiceWorker";

export const metadata: Metadata = {
  title: "しっぽり亭 予約管理",
  description: "しっぽり亭 店舗予約管理",
  // 予約データには氏名と電話番号が入る。検索エンジンに拾わせない。
  robots: { index: false, follow: false },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  /*
   * PWAの設定はスタッフ用とお客様用で分ける。
   * 以前は app/manifest.ts が全ページに1つのマニフェスト（開始URL=/login・
   * 名前「しっぽり管理」）を配っていたため、お客様が予約ページを
   * ホーム画面に追加すると**スタッフのログイン画面のショートカット**ができていた。
   * ここ（既定）はスタッフ用。/yoyaku 配下は layout が予約用に上書きする。
   */
  manifest: "/manifest.webmanifest",
  // iOS は manifest の standalone を読まないので、こちらでも宣言する
  appleWebApp: {
    capable: true,
    title: "しっぽり管理",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#111726",
  width: "device-width",
  initialScale: 1,
  // ノッチとホームインジケータを避けるため。実際の余白は env(safe-area-inset-*) で入れる。
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
