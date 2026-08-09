import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth";

/**
 * 自分のパスワードを変更する。
 *
 * must_change_password を false に戻すのは service_role で行う。
 * 「自分の profiles 行なら更新できる」という RLS ポリシーを置くと、
 * RLS は列を絞れないので一般スタッフが自分の role を owner に書き換えられてしまう。
 * だから profiles への書き込み口は account.write 保持者とこのAPIだけにする。
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const password = String(body?.password ?? "");

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

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return NextResponse.json(
      { error: "パスワードを変更できませんでした。別のパスワードをお試しください。" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  await admin.from("profiles").update({ must_change_password: false }).eq("id", user.id);

  return NextResponse.json({ ok: true });
}
