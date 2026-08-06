import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { requireProfile } from "@/lib/auth";
import { getMyOpenCheckIn } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import type { Settings } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();

  // 初回ログイン時はパスワード変更を先に済ませる
  if (profile.must_change_password) redirect("/password");

  const supabase = await createClient();
  const [{ data: settings }, openCheckIn] = await Promise.all([
    supabase.from("settings").select("*").eq("id", true).maybeSingle<Settings>(),
    getMyOpenCheckIn(profile.id),
  ]);

  return (
    <>
      <Nav
        facilityName={settings?.facility_name ?? "The Oldman"}
        displayName={profile.display_name}
        isCheckedIn={openCheckIn !== null}
      />
      <main className="shell">{children}</main>
    </>
  );
}
