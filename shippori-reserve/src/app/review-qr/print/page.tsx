import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { REVIEW_ASK, REVIEW_BODY, reviewQr } from "@/lib/review-qr";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

/**
 * 印刷用：名刺サイズ（91×55mm）のカード9枚をA4横に。レジ横・伝票ばさみ・卓に置く。
 * 切り取り線つき。文面に特典は書かない（Googleのルール）。
 */
export default async function ReviewQrPrintPage() {
  await requireProfile();
  const qr = await reviewQr();
  if (!qr) return <p style={{ padding: "2rem" }}>口コミのリンクが設定されていません（settings の review_url）。</p>;
  return (
    <div className="rqp">
      <div className="rqp__bar">
        <Link href="/settings" className="btn btn-sm">
          ‹ 設定へ
        </Link>
        <PrintButton />
        <span className="rqp__hint">A4横・倍率100%（実際のサイズ）で印刷し、点線で切ってください。</span>
      </div>
      <div className="rqp__scroll">
      <div className="rqp__sheet">
        {Array.from({ length: 9 }, (_, i) => (
          <div className="rqp__card" key={i}>
            <div className="rqp__qr" dangerouslySetInnerHTML={{ __html: qr.svg }} />
            <div className="rqp__text">
              <p className="rqp__ask">{REVIEW_ASK}</p>
              <p className="rqp__body">{REVIEW_BODY}</p>
              <p className="rqp__shop">しっぽり亭</p>
            </div>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
