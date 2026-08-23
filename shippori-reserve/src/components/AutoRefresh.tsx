"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isDirty } from "@/lib/dirty";

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
      // 入力途中(未保存)の画面があるときは最新化を見送る。保存されたら再開する
      if (document.visibilityState === "visible" && !isDirty()) router.refresh();
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
