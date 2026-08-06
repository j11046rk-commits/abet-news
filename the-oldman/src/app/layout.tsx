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
  title: "The Oldman",
  description: "会員制プライベートクラブの運営ダッシュボード",
  robots: { index: false, follow: false },
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
