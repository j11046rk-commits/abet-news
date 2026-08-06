"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { checkIn, checkOut } from "@/app/(app)/checkin/actions";

/**
 * チェックインはどのタブからでも押せるよう、マストヘッド（sticky）に置く。
 * 滞在中は「退出する」に変わる。押した結果の語は、押す前の語と揃える。
 */
export default function CheckInButton({ isIn }: { isIn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    await (isIn ? checkOut() : checkIn());
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      className={`btn btn-sm${isIn ? "" : " btn-primary"}`}
      onClick={toggle}
      disabled={busy}
      aria-pressed={isIn}
    >
      {busy ? "…" : isIn ? "退出する" : "チェックイン"}
    </button>
  );
}
