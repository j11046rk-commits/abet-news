"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * みんなで共有して使うので、画面を常に最新に保つ。
 * アプリに戻った瞬間と、表示中は60秒ごとにサーバーから取り直す。
 * これは一段目。二段目として、保存の瞬間にサーバー側でも席の重なりを
 * 必ず再チェックしている（画面が古くても二重予約は保存時に止まる）。
 */
export default function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
    };
  }, [router]);

  return null;
}
