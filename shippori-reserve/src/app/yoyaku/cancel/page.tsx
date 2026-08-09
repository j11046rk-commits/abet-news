import type { Metadata } from "next";
import NetCancel from "@/components/NetCancel";

export const metadata: Metadata = {
  title: "ご予約のキャンセル｜しっぽり亭（新居浜）",
  robots: { index: false, follow: false },
};

export default function NetCancelPage() {
  return <NetCancel />;
}
