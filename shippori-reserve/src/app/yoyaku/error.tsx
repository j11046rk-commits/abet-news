"use client";

/**
 * 予約ページで予期しないエラーが起きたときの受け皿。
 *
 * これが無いと Next.js 既定の英語の白画面が出る。お客様にとっては
 * 「壊れた店」にしか見えず、そのまま帰ってしまう——予約が1件消えるのと同じ。
 * 直せる道（読み込み直し）と、確実な道（電話）の2つを必ず出す。
 */
export default function YoyakuError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ maxWidth: "28rem", margin: "4rem auto", padding: "0 1.2rem", textAlign: "center" }}>
      <p style={{ fontSize: "2rem", margin: 0 }}>🙇</p>
      <h2 style={{ margin: "0.6rem 0" }}>ページを表示できませんでした</h2>
      <p style={{ lineHeight: 1.8 }}>
        申し訳ございません。一時的な不具合の可能性があります。
        <br />
        下のボタンでもう一度お試しください。
      </p>
      <p>
        <button
          className="btn btn-primary"
          onClick={() => reset()}
          style={{ padding: "0.7rem 1.6rem", fontSize: "1rem" }}
        >
          もう一度読み込む
        </button>
      </p>
      <p style={{ lineHeight: 1.8 }}>
        お急ぎの場合は、お電話でご予約を承ります。
        <br />
        <a href="tel:0897474494" style={{ fontWeight: 700, fontSize: "1.15rem" }}>
          0897-47-4494
        </a>
        （しっぽり亭）
      </p>
    </div>
  );
}
