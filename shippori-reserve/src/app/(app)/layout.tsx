import Nav from "@/components/Nav";
import { requireProfile } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // 未ログイン・停止中・初回パスワード未変更はここで弾かれる。
  await requireProfile();

  return (
    <div className="app">
      {/*
        自動での取り直し（AutoRefresh）は、ここではなく「動きのある画面」だけに置く。
        全画面に置くと、売上・シフト・設定のように滅多に変わらない画面まで
        60秒ごとにサーバーで描き直していた。席ボードに至っては自前で15秒ごとに
        取り直しているので、その上から丸ごと描き直す二重の無駄になっていた。
      */}
      {children}
      <Nav />
    </div>
  );
}
