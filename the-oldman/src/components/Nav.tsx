"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import CheckInButton from "@/components/CheckInButton";

type Item = { href: string; ja: string; en: string };

const ITEMS: Item[] = [
  // TOP は日本語も英語も同じ綴りなので、en を空にして1行だけ出す。
  { href: "/", ja: "TOP", en: "" },
  { href: "/reservations", ja: "予約", en: "BOOK" },
  { href: "/calendar", ja: "カレンダー", en: "CAL" },
  { href: "/sessions", ja: "セッション", en: "TABLE" },
  { href: "/ledger", ja: "台帳", en: "LEDGER" },
  { href: "/wishlist", ja: "リスト", en: "WISH" },
];

export default function Nav({
  facilityName,
  displayName,
  isCheckedIn,
}: {
  facilityName: string;
  displayName: string;
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
   * タブに混ぜると「別の画面へ行くもの」に見えてしまうので、
   * 施設名の横 — 画面全体に対する操作が集まっている場所 — に置く。
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
        <button
          className={`refresh${refreshing ? " is-busy" : ""}`}
          onClick={refresh}
          aria-label="表示を更新"
          title="表示を更新"
        >
          <span className="refresh__mark" aria-hidden>
            &#8635;
          </span>
        </button>
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
            {it.en ? <span className="nav__en">{it.en}</span> : null}
            <span className={`nav__ja${it.en ? "" : " is-solo"}`}>{it.ja}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
