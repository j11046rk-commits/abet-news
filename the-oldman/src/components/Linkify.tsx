import type { ReactNode } from "react";

/**
 * 拾うのは http/https だけ。javascript: のような書き方はリンクにしない。
 *
 * 続く文字は URL に使える ASCII だけに絞る。「空白まで全部」にすると
 * 「候補（https://example.com/x）。色は黒がいい。」のように URL の直後へ
 * 空白なしで日本語が続いたとき、そこまで飲み込んでリンクが壊れる。
 */
const URL_RE = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;

/**
 * URLの末尾に付きがちな文字。
 * 「…(https://example.com)」のように書かれたときの閉じ括弧や句点まで
 * リンクに含めると、その URL は開けない。
 */
const TRAILING = /[.,!?;:)\]}'"]+$/;

/**
 * 文中の URL をリンクにする。
 *
 * 備考欄には商品ページの URL がそのまま貼られる。文字のままだと
 * 長押ししてコピーして貼り直すことになるので、押したら開くようにする。
 */
export default function Linkify({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;

  for (const m of text.matchAll(URL_RE)) {
    const start = m.index;
    const url = m[0].replace(TRAILING, "");
    if (!url) continue;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <a
        key={start}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="linkified"
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>,
    );
    last = start + url.length;
  }

  if (last === 0) return <>{text}</>;
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
