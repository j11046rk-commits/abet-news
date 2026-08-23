import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValidLoginId, loginIdToEmail } from "@/lib/auth";
import { RATE, clientIp, recordAttempt, withinLimit } from "@/lib/rate-limit";
import type { Profile } from "@/lib/types";

/**
 * ログインID + パスワードでのサインイン。
 * ID → email の変換規則はここ（サーバー側）にだけ存在する。
 *
 * ★総当たりを止めるのはここ。
 *   Supabase Auth 側にもレート制限はあるが、signInWithPassword を呼ぶのは
 *   このサーバーなので、Supabase から見える送信元は攻撃者ではなく Vercel になる。
 *   つまり (a) アカウント単位では一切絞られず、(b) 制限が発動したときに
 *   締め出されるのは攻撃者ではなく現場のスタッフになる。だから自分で数える。
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const loginId = String(body?.login_id ?? "")
    .trim()
    .toLowerCase();
  const password = String(body?.password ?? "");
  const ip = clientIp(request.headers);

  // 失敗メッセージは常に同一。IDの存在有無を推測させない。
  const deny = () =>
    NextResponse.json({ error: "ログインIDまたはパスワードが違います。" }, { status: 401 });

  if (!loginId || !password || !isValidLoginId(loginId)) return deny();

  if (!(await withinLimit(RATE.login, loginId, ip))) {
    return NextResponse.json(
      { error: "しばらくお待ちください。ログインの試行が続いたため、一時的に受け付けを止めています。" },
      { status: 429 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: loginIdToEmail(loginId),
    password,
  });

  if (error || !data.user) {
    // 失敗だけを数える。正しく入れている人は何度ログインしても止まらない。
    await recordAttempt("login", loginId, ip, false);
    return deny();
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .maybeSingle<Profile>();

  if (!profile) {
    await supabase.auth.signOut();
    return NextResponse.json(
      { error: "このアカウントは登録されていません。オーナーにお問い合わせください。" },
      { status: 403 },
    );
  }

  if (!profile.is_active) {
    await supabase.auth.signOut();
    return NextResponse.json(
      { error: "このアカウントは現在無効です。オーナーにお問い合わせください。" },
      { status: 403 },
    );
  }

  return NextResponse.json({
    ok: true,
    must_change_password: profile.must_change_password,
  });
}
