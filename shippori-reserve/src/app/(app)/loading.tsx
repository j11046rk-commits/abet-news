/**
 * 画面が出るまでの骨組み。
 *
 * これが無いと、タップしてからサーバーが全部返し終わるまで前の画面のまま止まる。
 * 待ち時間そのものは変わらないが、「押したのに何も起きない」時間が消える——
 * 実際の速さより、この無反応の数百ミリ秒のほうが「重い」と感じさせる。
 *
 * 形は各画面に共通する並び（見出し・カード・一覧）に寄せてある。
 * 中身が来たときに位置が飛ばないように。
 */
export default function Loading() {
  return (
    <div className="wrap stack" aria-busy="true" aria-label="読み込み中">
      <div className="skel skel--bar" />
      <div className="skel skel--card" />
      <div className="skel skel--row" />
      <div className="skel skel--row" />
      <div className="skel skel--row" />
    </div>
  );
}
