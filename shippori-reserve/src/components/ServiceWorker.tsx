"use client";

import { useEffect } from "react";

/** Service Worker の登録だけを担う。中身は public/sw.js。 */
export default function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // 登録できなくてもアプリは動く。オフライン表示が出ないだけ。
    });
  }, []);

  return null;
}
