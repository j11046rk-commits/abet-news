import type { Metadata } from "next";
import Image from "next/image";

/**
 * ネット予約（お客様向け・ログイン不要）の共通枠。
 * スタッフ用アプリと同じ濃紺×金の見た目だが、タブバーやログイン導線は持たない。
 */
export const metadata: Metadata = {
  title: "ネット予約｜しっぽり亭（新居浜）",
  description:
    "新居浜のおばんざい居酒屋「しっぽり亭」のネット予約。空席をその場で確認して、そのままご予約いただけます（8名様まで・当日は2時間前まで）。",
  robots: { index: true, follow: true },
};

export default function NetLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="net">
      <header className="net__head">
        <Image src="/logo-mark.png" alt="" width={44} height={44} priority />
        <div>
          <p className="net__shop">おばんざい居酒屋 しっぽり亭</p>
          <h1 className="net__title">ネット予約</h1>
        </div>
      </header>
      {children}
      <footer className="net__pagefoot">
        <p>しっぽり亭（愛媛・新居浜） ／ 火曜定休</p>
        <p>お電話：<a href="tel:0897474494">0897-47-4494</a> ／ <a href="https://shipporitei.jp">公式サイト</a></p>
      </footer>
    </div>
  );
}
