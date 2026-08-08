import Nav from "@/components/Nav";
import { requireProfile } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // 未ログイン・停止中・初回パスワード未変更はここで弾かれる。
  await requireProfile();

  return (
    <div className="app">
      {children}
      <Nav />
    </div>
  );
}
