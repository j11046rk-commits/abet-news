"use client";

/**
 * 読み込みに失敗したときの画面。
 *
 * これが無いと、データが取れなかったときに画面が「空」で描かれる。
 * 予約の一覧が空なら「今夜は予約ゼロ」に見えるし、売上が空なら
 * 「まだ実績が入っていない」に見える。どちらも嘘で、しかも
 * 嘘だと気づけないのがいちばん困る。
 *
 * 通信が一瞬切れただけのことが多いので、まず「もう一度」を大きく出す。
 */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="wrap stack" style={{ paddingTop: "3rem", textAlign: "center" }}>
      <p style={{ fontSize: "2.2rem", margin: 0 }}>…</p>
      <h1 style={{ fontSize: "1.15rem", margin: 0 }}>うまく読み込めませんでした</h1>
      <p className="micro" style={{ margin: 0 }}>
        通信が途切れたときによく起きます。もう一度お試しください。
        <br />
        何度やっても直らないときは、画面をそのままにして知らせてください。
      </p>
      <div className="row" style={{ justifyContent: "center", gap: "0.6rem", marginTop: "0.5rem" }}>
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          もう一度
        </button>
        <a className="btn" href="/">
          カレンダーへ
        </a>
      </div>
      <p className="micro" style={{ marginTop: "1.5rem", opacity: 0.7 }}>
        ※ 表示できなかっただけで、予約のデータが消えたわけではありません。
      </p>
    </div>
  );
}
