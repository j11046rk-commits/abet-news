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
const TABS = [
  { href: "/", label: "暦", icon: "▦" },
  { href: "/today", label: "今日", icon: "☀︎" },
  { href: "/reservations", label: "予約", icon: "☰" },
  { href: "/settings", label: "設定", icon: "⚙" },
];

export default function Nav() {
  const pathname = usePathname();

  const isCurrent = (href: string) =>
    href === "/"
      ? pathname === "/"
      : href === "/today"
        ? pathname === "/today" || pathname.startsWith("/day/")
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
