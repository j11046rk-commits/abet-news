"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * どの画面でも一番上に出すアプリ名（店主指定 2026-11-04）。
 * 席ボードは営業中に置きっぱなしで使う全画面の画面なので出さない（自分で上の余白を持っている）。
 * 右端の⚙が設定への入口（下のタブから外した・店主指定 2026-11-09）。
 */
export const APP_NAME = "しっぽり亭店舗管理アプリ";

export default function BrandBar() {
  const pathname = usePathname();
  if (pathname.startsWith("/board")) return null;
  return (
    <div className="brandbar" role="banner">
      {APP_NAME}
      <Link
        href="/settings"
        className="brandbar__gear"
        aria-label="設定"
        aria-current={pathname === "/settings" || pathname.startsWith("/settings/") ? "page" : undefined}
      >
        ⚙
      </Link>
    </div>
  );
}
