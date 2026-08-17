import type { Metadata } from "next";
import Image from "next/image";
import Script from "next/script";

/**
 * ネット予約（お客様向け・ログイン不要）の共通枠。
 * スタッフ用アプリと同じ濃紺×金の見た目だが、タブバーやログイン導線は持たない。
 */
export const metadata: Metadata = {
  title: "ネット予約｜しっぽり亭（新居浜）",
  description:
    "新居浜のおばんざい居酒屋「しっぽり亭」のネット予約。空席をその場で確認して、その場でご予約が確定します（8名様まで・当日は開始15分前まで）。",
  robots: { index: true, follow: true },
};

/*
 * アクセス計測（GA4）。お客様向けのページだけに入れる。
 *
 * 公式サイト（shipporitei.jp）と同じ測定IDを使うので、
 * 「HPを見た人が予約ページに来て、何人が予約まで進んだか」が1本で追える。
 * 何人が見たかが分からないと、予約が少ないときに
 * 「フォームのどこかで諦められている」のか「そもそも来ていない」のかが
 * 区別できず、打つ手が真逆になる。
 *
 * ★スタッフ用の画面には入れない。
 *   予約者の氏名と電話番号が並ぶ画面なので、外部のタグを置かない。
 *
 * ★URLの「?」以降は送らない。
 *   キャンセルのリンクは /yoyaku/cancel?t=<合言葉> の形で、
 *   これは他人の予約を消せる鍵そのもの。GA4は既定でURLを丸ごと送るので、
 *   明示的にパスだけに差し替える。
 */
const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? "";

export default function NetLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="net">
      {GA_ID ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-net" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());
gtag('config','${GA_ID}',{page_location:location.origin+location.pathname,page_path:location.pathname});`}
          </Script>
        </>
      ) : null}
      <a className="net__home" href="https://shipporitei.jp">
        ‹ ホームページ
      </a>
      <header className="net__head">
        <Image src="/logo-face.png" alt="" width={44} height={44} priority />
        <div>
          <p className="net__shop">おばんざい居酒屋 しっぽり亭</p>
          <h1 className="net__title">ネット予約</h1>
        </div>
      </header>
      {children}
      <footer className="net__pagefoot">
        <p>しっぽり亭（愛媛・新居浜） ／ 火曜定休</p>
        <p>お電話：<a href="tel:0897474494">0897-47-4494</a> ／ <a href="https://shipporitei.jp">公式サイト</a></p>
        {/*
          はじめての端末で yoyaku.shipporitei.jp を開くと、middleware がここ（予約ページ）へ送る。
          チラシに短いURLだけを載せられるようにした作りだが、そのぶん
          スタッフに管理アプリのURLを送ったときも、相手の端末では予約ページが開く。
          行き止まりにしないための、静かな戻り道。お客様の邪魔にならない大きさで置く。
        */}
        <p className="net__staff">
          <a href="/login">スタッフの方はこちら</a>
        </p>
      </footer>
    </div>
  );
}
