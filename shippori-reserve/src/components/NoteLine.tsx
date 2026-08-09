"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 暦の予約行の下に出すコース・メモの1行。
 * 収まりきらないときだけ「全文」ボタンが現れ、開くと「閉じる」で1行に戻せる。
 * タップしても予約詳細には飛ばない（飛ぶのは上の行）。
 */
export default function NoteLine({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (open) return; // 開いている間は折り返すので計らない
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);

  return (
    <div className="mnote">
      <span ref={ref} className={`mnote__text ${open ? "mnote__text--open" : ""}`}>
        {text}
      </span>
      {overflows || open ? (
        <button type="button" className="mnote__btn" onClick={() => setOpen((v) => !v)}>
          {open ? "閉じる" : "全文"}
        </button>
      ) : null}
    </div>
  );
}
