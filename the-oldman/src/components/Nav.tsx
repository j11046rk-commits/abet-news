"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import CheckInButton from "@/components/CheckInButton";

type Item = { href: string; ja: string; en: string };

const ITEMS: Item[] = [
  { href: "/", ja: "TOP", en: "TOP" },
  { href: "/reservations", ja: "予約", en: "BOOK" },
  { href: "/calendar", ja: "カレンダー", en: "CAL" },
  { href: "/sessions", ja: "セッション", en: "TABLE" },
  { href: "/ledger", ja: "台帳", en: "LEDGER" },
];

export default function Nav({
  facilityName,
  displayName,
  isOwner,
  isCheckedIn,
}: {
  facilityName: string;
  displayName: string;
  isOwner: boolean;
  isCheckedIn: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // メンバーと設定はタブから外した。滅多に使わないので、台帳の末尾からリンクで入る。
  const items = ITEMS;

  const active = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  /*
   * ホーム画面から起動すると引っ張って更新ができない。
   * 下部ナビの右端に置く。親指が届く位置のほうが実際に押される。
   */
  function refresh() {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 700);
  }

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <header className="masthead">
        <Link href="/" className="masthead__brand">
          <span className="masthead__name">{facilityName}</span>
          <span className="masthead__sub">MATSUYAMA · EST. 2026</span>
        </Link>
        <div className="masthead__right">
          <span className="micro masthead__who">{displayName}</span>
          {/* チェックインはどのタブからでも押せるよう、sticky なマストヘッドに置く */}
          <CheckInButton isIn={isCheckedIn} />
          <button className="btn btn-sm" onClick={signOut} disabled={busy}>
            ログアウト
          </button>
        </div>
      </header>

      <nav className="nav" aria-label="メインナビゲーション">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className={`nav__item${active(it.href) ? " is-active" : ""}`}
            aria-current={active(it.href) ? "page" : undefined}
          >
            <span className="nav__en">{it.en}</span>
            <span className="nav__ja">{it.ja}</span>
          </Link>
        ))}

        <button
          className={`nav__item nav__refresh${refreshing ? " is-busy" : ""}`}
          onClick={refresh}
          aria-label="表示を更新"
        >
          <span className="nav__en">SYNC</span>
          <span className="nav__ja">{refreshing ? "更新中" : "更新"}</span>
        </button>
      </nav>
    </>
  );
}
