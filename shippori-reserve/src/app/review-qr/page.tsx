import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { REVIEW_ASK, REVIEW_BODY, reviewQr } from "@/lib/review-qr";

export const dynamic = "force-dynamic";

/**
 * 会計のときにお客様へ見せる口コミのQR（席ボード・設定から開く）。画面いっぱいに出す。
 * 渡すのは全員に同じように。見返りは付けない（Googleのルール）。
 */
export default async function ReviewQrPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  await requireProfile();
  const sp = await searchParams;
  const back = sp.from === "board" ? "/board" : "/settings";
  const qr = await reviewQr();
  return (
    <main className="rq">
      <Link href={back} className="rq__back">
        ‹ 戻る
      </Link>
      {qr ? (
        <div className="rq__card">
          <p className="rq__ask">{REVIEW_ASK}</p>
          <div className="rq__qr" aria-label="Googleマップの口コミのQRコード" dangerouslySetInnerHTML={{ __html: qr.svg }} />
          <p className="rq__body">{REVIEW_BODY}</p>
          <p className="rq__shop">しっぽり亭</p>
        </div>
      ) : (
        <p className="rq__none">口コミのリンクが設定されていません（settings の review_url）。</p>
      )}
      <p className="rq__staff">
        スタッフへ：会計のときに、どのお客様にも同じように「よろしければ」と見せてください。割引やサービスと引き換えにお願いするのは、Googleのルールで禁止されています。
      </p>
    </main>
  );
}
