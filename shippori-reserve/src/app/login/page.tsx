import type { Metadata } from "next";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "しっぽり亭 予約管理" };

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
        <header>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" className="gate__logo" />
          <h1 className="gate__title">
            しっぽり亭 予約管理
            <span className="brand-dot" aria-hidden>
              .
            </span>
          </h1>
          <p className="micro gate__sub">NIIHAMA · STAFF ONLY</p>
        </header>

        {notice ? <p className="notice notice-strong">{notice}</p> : null}

        <LoginForm next={sp.next} />

        <p className="micro gate__foot">
          アカウントはオーナーが発行します。
          <br />
          パスワードを忘れた場合はオーナーに再発行を依頼してください。
        </p>

        {/*
          お客様がここに着くことがある（短いURLだけを見て入力した場合など）。
          「STAFF ONLY」と書かれた画面で行き止まりにせず、1タップで予約へ渡す。
        */}
        <p className="gate__guest">
          <a href="/yoyaku">ご予約のお客様はこちら ›</a>
        </p>
      </div>
    </div>
  );
}
