import type { Metadata } from "next";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "The Oldmans" };

const MESSAGES: Record<string, string> = {
  noprofile: "このアカウントは登録されていません。オーナーにお問い合わせください。",
  inactive: "このアカウントは現在無効です。オーナーにお問い合わせください。",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; e?: string }>;
}) {
  const sp = await searchParams;
  const notice = sp.e ? MESSAGES[sp.e] : undefined;

  return (
    <div className="gate">
      <div className="gate__inner">
        <header className="gate__head">
          <h1 className="gate__title">
            The Oldmans
            <span className="brand-dot" aria-hidden>
              .
            </span>
          </h1>
          <p className="micro gate__sub">MATSUYAMA · MEMBERS ONLY</p>
        </header>

        <div className="rule">
          <span className="label">Sign in</span>
        </div>

        {notice ? <p className="notice notice-strong gate__notice">{notice}</p> : null}

        <LoginForm next={sp.next} />

        <p className="micro gate__foot">
          アカウントはオーナーが発行します。
          <br />
          パスワードを忘れた場合はオーナーに再発行を依頼してください。
        </p>
      </div>
    </div>
  );
}
