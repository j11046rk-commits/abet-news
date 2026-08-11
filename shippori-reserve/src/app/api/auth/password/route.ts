import { NextResponse } from "next/server";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { RATE, clientIp, recordAttempt, withinLimit } from "@/lib/rate-limit";
import type { Profile } from "@/lib/types";

/**
 * 自分のパスワードを変更する。
 *
 * must_change_password を false に戻すのは service_role で行う。
 * 「自分の profiles 行なら更新できる」という RLS ポリシーを置くと、
 * RLS は列を絞れないので一般スタッフが自分の role を owner に書き換えられてしまう。
 * だから profiles への書き込み口は account.write 保持者とこのAPIだけにする。
 *
 * ★いま使っているパスワードを必ず確かめる。
 *   店の端末は使い回しで、ログインしたままカウンターに置かれる。
 *   誰でも触れる状態で「新しいパスワード」だけで変えられると、
 *   その場に居合わせた人が本人を締め出せてしまう。
 *   例外は初回（must_change_password）だけ——たったいまログインで
 *   そのパスワードを打った直後なので、もう一度打たせる意味がない。
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const password = String(body?.password ?? "");
  const current = String(body?.current ?? "");
  const ip = clientIp(request.headers);

  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください。` },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();
  if (!profile || !profile.is_active) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  if (!profile.must_change_password) {
    if (!user.email) {
      return NextResponse.json({ error: "変更できませんでした。" }, { status: 400 });
    }
    if (!current) {
      return NextResponse.json(
        { error: "いま使っているパスワードを入力してください。" },
        { status: 400 },
      );
    }
    // 総当たりの入口を増やさない。ログインと同じ数え方で止める。
    if (!(await withinLimit(RATE.login, `pw:${user.id}`, ip))) {
      return NextResponse.json(
        { error: "しばらくお待ちください。入力が続いたため、一時的に受け付けを止めています。" },
        { status: 429 },
      );
    }

    // 確かめるだけの使い捨てクライアント。Cookie を持たないので、
    // ここでサインインしても、いま開いているログインは差し替わらない。
    const probe = createPlainClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error: wrong } = await probe.auth.signInWithPassword({
      email: user.email,
      password: current,
    });
    if (wrong) {
      await recordAttempt("login", `pw:${user.id}`, ip, false);
      return NextResponse.json(
        { error: "いま使っているパスワードが違います。" },
        { status: 401 },
      );
    }
    await probe.auth.signOut();
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return NextResponse.json(
      { error: "パスワードを変更できませんでした。別のパスワードをお試しください。" },
      { status: 400 },
    );
  }

  // 他の端末のログインは切る。パスワードを変える理由の多くは
  // 「誰かに見られたかもしれない」なので、変えたのに前のログインが
  // 生きたままだと、変えた意味がほとんど無くなる。
  await supabase.auth.signOut({ scope: "others" });

  const admin = createAdminClient();
  await admin.from("profiles").update({ must_change_password: false }).eq("id", user.id);

  return NextResponse.json({ ok: true });
}
