import "server-only";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { isReviewUrl } from "@/lib/review-request";

/**
 * 店内で見せる・配る口コミのQR（2026-11-07・店主承認）。
 * LINEのお願いは「LINEつきの予約」にしか届かず、10/25〜11/6 の来店32組のうち3組だけだった。
 * 電話・スタッフ入力・LINEなしのネット予約のお客様にも、会計のときに同じお願いができるようにする。
 *
 * ★Googleのルール：見返り（割引・一品サービス等）を付けない。満足していそうな人だけに頼まない
 *   （全員に同じように渡す）。文面にも特典は書かない。
 */
export async function reviewQr(): Promise<{ url: string; svg: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("value").eq("key", "review_url").maybeSingle();
  const url = typeof data?.value === "string" ? data.value.trim() : null;
  if (!isReviewUrl(url)) return null;
  // 誤り訂正 M・余白2マス。印刷でもスマホ画面でも読める濃さ（黒地白ではなく白地黒）
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#111111", light: "#ffffff" } });
  return { url, svg };
}

export const REVIEW_ASK = "ご来店ありがとうございました";
export const REVIEW_BODY = "よろしければ、Googleマップにご感想をお聞かせください。ひと言だけでも励みになります。";
