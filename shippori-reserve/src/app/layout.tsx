import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorker from "@/components/ServiceWorker";

export const metadata: Metadata = {
  title: "しっぽり亭 予約管理",
  description: "しっぽり亭 店舗予約管理",
  // 予約データには氏名と電話番号が入る。検索エンジンに拾わせない。
  robots: { index: false, follow: false },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
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
