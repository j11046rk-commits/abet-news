import Link from "next/link";

/** 衛生管理の中の行き来（今日のチェック・計画・異常・月の確認・出力） */
export default function HaccpTabs({ current, canManage }: { current: string; canManage: boolean }) {
  const tabs = [
    { href: "/haccp", key: "day", label: "今日のチェック" },
    // 温度計は今日のチェックのすぐ横（店主指定 2026-11-08）
    ...(canManage ? [{ href: "/haccp/sensors", key: "sensors", label: "温度計" }] : []),
    { href: "/haccp/incidents", key: "incidents", label: "異常・改善" },
    { href: "/haccp/plan", key: "plan", label: "計画" },
    ...(canManage ? [{ href: "/haccp/month", key: "month", label: "月の確認・出力" }] : []),
  ];
  return (
    <nav className="hc-tabs" aria-label="衛生管理の画面">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className="hc-tabs__item" aria-current={current === t.key ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
