"use client";

import { useRouter } from "next/navigation";

/**
 * 来た画面に戻る。暦から開いたら暦へ、日別から開いたら日別へ。
 * 履歴が無いとき（URL直叩き）だけ fallback へ。
 */
export default function BackButton({ fallback }: { fallback: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallback);
      }}
    >
      ‹ 戻る
    </button>
  );
}
