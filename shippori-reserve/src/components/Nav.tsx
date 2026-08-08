"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 下タブ。iPhone の片手操作が基準なので、移動は必ず親指の届く下半分に置く。
 * ホームは暦（縦スクロールの1か月）。予約登録・営業日設定は各画面から入る。
 *
 * 集計（S10）は Phase 4 の画面なのでまだ並べない。
 * 中身の無いタブを置いておくより、増えたときに足すほうがよい。
 */
// 今日タブ・予約タブは廃止（店主指定 2026-08-08 その12）。
// カレンダーで日付をタップ→日別、が基本動線。予約の検索はカレンダー上部から。
const TABS = [
  { href: "/", label: "カレンダー", icon: "▦" },
  { href: "/shifts", label: "シフト", icon: "◷" },
  { href: "/sales", label: "売上", icon: "¥" },
  { href: "/settings", label: "設定", icon: "⚙" },
];

export default function Nav() {
  const pathname = usePathname();

  const isCurrent = (href: string) =>
    href === "/"
      ? pathname === "/" ||
        pathname === "/today" ||
        pathname.startsWith("/day/") ||
        pathname.startsWith("/reservations") ||
        pathname.startsWith("/calendar/")
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="tabbar" aria-label="メインナビゲーション">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className="tabbar__item"
          aria-current={isCurrent(t.href) ? "page" : undefined}
        >
          <span className="tabbar__ico" aria-hidden>
            {t.icon}
          </span>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
