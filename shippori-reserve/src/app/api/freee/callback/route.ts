import { NextResponse, type NextRequest } from "next/server";
import { apiProfile } from "@/lib/auth";
import { connectFreee, FREEE_REDIRECT_PATH, syncLabor } from "@/lib/freee";
import { shiftDate, todayBizDate } from "@/lib/time";

/**
 * freee で「許可する」を押したあとに戻ってくる先。
 * 認可コードをトークンに替えて保存し、直近90日の勤怠をその場で取り込む。
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = url.origin;
  const back = (q: string) => {
    const res = NextResponse.redirect(`${origin}/settings?freee=${q}`, 303);
    res.cookies.delete({ name: "freee_state", path: "/api/freee" });
    return res;
  };

  const auth = await apiProfile("settings.write");
  if (!auth.ok) return back("forbidden");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = request.cookies.get("freee_state")?.value;
  if (!code || !state || !expected || state !== expected) return back("badstate");

  try {
    await connectFreee(code, `${origin}${FREEE_REDIRECT_PATH}`);
  } catch (e) {
    console.error("freee_connect_failed", e instanceof Error ? e.message : e);
    return back("error");
  }

  // 取り込みに失敗しても連携自体は済んでいる（毎朝の定期実行で取り直す）
  try {
    const today = todayBizDate();
    await syncLabor(shiftDate(today, -90), shiftDate(today, -1));
  } catch (e) {
    console.error("freee_initial_sync_failed", e instanceof Error ? e.message : e);
    return back("connected_nosync");
  }
  return back("ok");
}
