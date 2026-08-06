import type { Metadata } from "next";
import WishlistClient from "./WishlistClient";
import { requireProfile } from "@/lib/auth";
import { getProfiles, getWishlist } from "@/lib/queries";

export const metadata: Metadata = { title: "リスト — The Oldman" };
export const dynamic = "force-dynamic";

export default async function WishlistPage() {
  const [, items, profiles] = await Promise.all([
    requireProfile(),
    getWishlist(),
    getProfiles(),
  ]);

  return (
    <>
      <header className="page">
        <h1 className="display">リスト</h1>
        <p className="dim page__lead">
          施設に置きたいものを書き留めておく場所です。買うかどうかは6人で決めます。
        </p>
      </header>

      <WishlistClient
        items={items}
        names={Object.fromEntries(profiles.map((p) => [p.id, p.display_name]))}
      />
    </>
  );
}
