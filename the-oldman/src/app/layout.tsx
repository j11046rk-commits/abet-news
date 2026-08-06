import type { Metadata, Viewport } from "next";
import { Bodoni_Moda, IBM_Plex_Mono, Inter, Noto_Sans_JP, Shippori_Mincho } from "next/font/google";
import "./globals.css";

const bodoni = Bodoni_Moda({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--f-display",
  display: "swap",
});

const shippori = Shippori_Mincho({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--f-mincho",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--f-sans",
  display: "swap",
});

const notoJp = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--f-jp",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--f-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://the-oldmans.vercel.app"),
  title: "The Oldmans",
  description: "会員制プライベートクラブの運営ダッシュボード",
  robots: { index: false, follow: false },
  // 真鍮のカジキの刻印。タブとホーム画面のアイコン。
  icons: { icon: "/images/icon-192.png", apple: "/images/apple-touch-icon.png" },
  // LINE等でURLを共有したときのカード。真っ黒なカードになるのを防ぐ。
  openGraph: {
    title: "The Oldmans",
    description: "MATSUYAMA · MEMBERS ONLY",
    images: ["/images/ogp.jpg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0C0D0F",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ja"
      className={`${bodoni.variable} ${shippori.variable} ${inter.variable} ${notoJp.variable} ${plexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
