"use client";

import { usePathname } from "next/navigation";

/**
 * どの画面でも一番上に出すアプリ名（店主指定 2026-11-04）。
 * 席ボードは営業中に置きっぱなしで使う全画面の画面なので出さない（自分で上の余白を持っている）。
 */
export const APP_NAME = "しっぽり亭店舗管理アプリ";

export default function BrandBar() {
  const pathname = usePathname();
  if (pathname.startsWith("/board")) return null;
  return (
    <div className="brandbar" role="banner">
      {APP_NAME}
    </div>
  );
}
