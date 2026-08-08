"use client";

import { useEffect } from "react";

/** 開いた瞬間に今日の位置へ。月ビューは「今日から下を見る」のが基本姿勢。 */
export default function ScrollTo({ id }: { id: string }) {
  useEffect(() => {
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [id]);
  return null;
}
