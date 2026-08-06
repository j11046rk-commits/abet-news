/**
 * タブを押した瞬間に出る一枚。
 *
 * これが無いと、サーバーが返してくるまで画面が前のページのまま止まる。
 * 1秒近く何も起きないので「押せていない」と感じ、もう一度押すことになる。
 * 中身は骨組みだけでよい — 伝えたいのは「受け付けた」ことだけ。
 */
export default function Loading() {
  return (
    <div className="skel" aria-busy="true" aria-label="読み込み中">
      <div className="skel__rule" />
      <div className="skel__line skel__line--lg" />
      <div className="skel__line" style={{ width: "62%" }} />
      <div className="skel__rule" />
      <div className="skel__line" style={{ width: "88%" }} />
      <div className="skel__line" style={{ width: "74%" }} />
      <div className="skel__line" style={{ width: "80%" }} />
    </div>
  );
}
