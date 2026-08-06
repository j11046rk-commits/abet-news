import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import PasswordForm from "./PasswordForm";

export const metadata: Metadata = { title: "パスワードの変更 — The Oldmans" };

export default async function PasswordPage() {
  const profile = await requireProfile();

  return (
    <div className="gate">
      <div className="gate__inner">
        <header className="gate__head">
          <h1 className="gate__title">The Oldmans</h1>
          <p className="micro gate__sub">MATSUYAMA · MEMBERS ONLY</p>
        </header>

        <div className="rule">
          <span className="label">Password</span>
        </div>

        <p className="dim gate__lead">
          {profile.must_change_password
            ? "初期パスワードのままです。新しいパスワードを設定してください。"
            : "新しいパスワードを設定します。"}
        </p>

        <PasswordForm forced={profile.must_change_password} />
      </div>
    </div>
  );
}
