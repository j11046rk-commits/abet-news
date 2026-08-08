import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { requireProfile } from "@/lib/auth";
import { getMyOpenCheckIn, getSettings } from "@/lib/queries";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();

  // 初回ログイン時はパスワード変更を先に済ませる
  if (profile.must_change_password) redirect("/password");

  // getSettings は cache() 済み。ページ側（getVault）と同じ1回の取得を共有する
  const [settings, openCheckIn] = await Promise.all([
    getSettings(),
    getMyOpenCheckIn(profile.id),
  ]);

  return (
    <>
      <Nav
        facilityName={settings.facility_name}
        displayName={profile.display_name}
        isCheckedIn={openCheckIn !== null}
      />
      <main className="shell">{children}</main>
    </>
  );
}
