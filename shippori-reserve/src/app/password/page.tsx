import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PasswordForm from "./PasswordForm";
import type { Profile } from "@/lib/types";

export const metadata = { title: "パスワードの変更" };

/**
 * must_change_password が true の間、他のどのページにも入れない（requireProfile がここへ飛ばす）。
 * このページ自身は requireProfile を使わない（自分自身へのリダイレクトで無限ループになるため）。
 */
export default async function PasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  if (!profile) redirect("/login?e=noprofile");
  if (!profile.is_active) redirect("/login?e=inactive");

  const first = profile.must_change_password;

  return (
    <div className="gate">
      <div className="gate__inner">
        <header>
          <h1 className="gate__title">パスワードの変更</h1>
          <p className="micro gate__sub">{profile.display_name} さん</p>
        </header>

        {first ? (
          <p className="notice notice-strong" style={{ marginTop: "1.4rem" }}>
            最初に、ご自分だけが知っているパスワードに変更してください。
            変更するまで他の画面は開けません。
          </p>
        ) : null}

        <PasswordForm first={first} />
      </div>
    </div>
  );
}
