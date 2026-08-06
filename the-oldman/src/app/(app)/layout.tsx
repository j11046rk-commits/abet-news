import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Settings } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();

  // 初回ログイン時はパスワード変更を先に済ませる
  if (profile.must_change_password) redirect("/password");

  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("settings")
    .select("*")
    .eq("id", true)
    .maybeSingle<Settings>();

  return (
    <>
      <Nav
        facilityName={settings?.facility_name ?? "The Oldman"}
        displayName={profile.display_name}
        isOwner={profile.role === "owner"}
      />
      <main className="shell">{children}</main>
    </>
  );
}
