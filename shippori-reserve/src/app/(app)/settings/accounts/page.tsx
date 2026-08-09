import Link from "next/link";
import AccountAdmin from "@/components/AccountAdmin";
import { requirePermission } from "@/lib/auth";
import { getAllProfiles } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** S12 アカウント管理（account.write を持つ人だけ＝初期はオーナー3名） */
export default async function AccountsPage() {
  const me = await requirePermission("account.write");
  const profiles = await getAllProfiles();

  return (
    <>
      <header className="appbar">
        <Link className="btn btn-sm" href="/settings">
          ‹ 設定
        </Link>
        <div className="appbar__title">アカウント管理</div>
      </header>

      <div className="wrap">
        <AccountAdmin profiles={profiles} meId={me.id} />
        <div style={{ height: "2rem" }} />
      </div>
    </>
  );
}
