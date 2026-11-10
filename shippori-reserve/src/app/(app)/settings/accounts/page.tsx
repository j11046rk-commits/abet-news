import Link from "next/link";
import AccountAdmin from "@/components/AccountAdmin";
import { requirePermission } from "@/lib/auth";
import { getAllProfiles } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** S12 アカウント管理（account.write＝オーナー・店長。店長はスタッフ・事務・閲覧のみの人だけ） */
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
        <AccountAdmin profiles={profiles} meId={me.id} meRole={me.role} />
        <div style={{ height: "2rem" }} />
      </div>
    </>
  );
}
