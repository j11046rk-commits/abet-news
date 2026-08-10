"use client";

/**
 * 「保存していない入力」が画面にあるかどうかの全体フラグ。
 * AutoRefresh(60秒ごとの自動最新化)はこれが立っている間は休む。
 * シフトの◯×を途中まで入れたところで画面が最新化されて消える事故を防ぐ。
 */
export function setDirty(v: boolean) {
  if (typeof window !== "undefined") {
    (window as unknown as { __shippori_dirty?: boolean }).__shippori_dirty = v;
  }
}

export function isDirty(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as unknown as { __shippori_dirty?: boolean }).__shippori_dirty === true
  );
}
