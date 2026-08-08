"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 下タブ。iPhone の片手操作が基準なので、移動は必ず親指の届く下半分に置く。
 * 予約登録（S4）・営業日設定（S7）はそれぞれの画面から入るのでタブには出さない。
 *
 * 設計上のタブは5つだが、集計（S10）は Phase 4 の画面なのでまだ並べない。
 * 中身の無いタブを置いておくより、増えたときに足すほうがよい。
 */
const TABS = [
  { href: "/", label: "今日", icon: "☀︎" },
  { href: "/reservations", label: "予約", icon: "☰" },
  { href: "/calendar", label: "暦", icon: "▦" },
  { href: "/settings", label: "設定", icon: "⚙" },
];

export default function Nav() {
  const pathname = usePathname();

  const isCurrent = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

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
