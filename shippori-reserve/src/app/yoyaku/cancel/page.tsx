import type { Metadata } from "next";
import NetCancel from "@/components/NetCancel";

export const metadata: Metadata = {
  title: "ご予約のキャンセル｜しっぽり亭（新居浜）",
  robots: { index: false, follow: false },
};

const TOKEN_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * ?t=<合言葉> で来たら、番号と電話番号を聞かずにキャンセルできる。
 * 形が合言葉として成立していないときは、ふつうの入力画面に落とす
 * （壊れたリンクで行き止まりにしない）。
 */
export default async function NetCancelPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const sp = await searchParams;
  const token = TOKEN_RE.test(sp.t ?? "") ? sp.t! : undefined;
  return <NetCancel token={token} />;
}
