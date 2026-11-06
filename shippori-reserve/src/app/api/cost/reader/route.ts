import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyApiToken } from "@/lib/api-token";
import { COST_BUCKET } from "@/lib/cost-data";
import { draftFromAi, parseAiDoc } from "@/lib/cost";
import { todayBizDate } from "@/lib/time";

/**
 * 原価の写真の読み取り口。読むのは定期実行の Claude（サブスクのセッション）で、API料金は使わない。
 * 守りは x-api-key（オーナーが画面で発行する合言葉・名前 cost_reader）。
 *
 *   GET  /api/cost/reader              … 読み取り待ちの一覧（古い順・最大30件）
 *   GET  /api/cost/reader?photo=<id>   … その写真そのもの（画像）
 *   POST /api/cost/reader              … 読んだ結果を返す
 *        { "id": "...", "doc": { doc_kind, vendor, date, period_from, period_to, total_in, lines[], note } }
 *        読めなかった写真は { "id": "...", "unreadable": "理由" }（人が手で入れる行になる）
 *
 * 結果は「未確認」として入る（原価率には入る）。人が写真と見比べて「確認した」か「直す」。
 */

const NAME = "cost_reader";
const ID_RE = /^[0-9a-f-]{36}$/;
const deny = () => NextResponse.json({ error: "認証できません。" }, { status: 401 });

export async function GET(request: Request) {
  if (!(await verifyApiToken(NAME, request.headers.get("x-api-key")))) return deny();
  const admin = createAdminClient();
  const photo = new URL(request.url).searchParams.get("photo");

  if (photo) {
    if (!ID_RE.test(photo)) return NextResponse.json({ error: "id が不正です。" }, { status: 400 });
    const { data: row } = await admin.from("cost_purchases").select("photo_path").eq("id", photo).maybeSingle();
    if (!row?.photo_path) return NextResponse.json({ error: "写真がありません。" }, { status: 404 });
    const { data, error } = await admin.storage.from(COST_BUCKET).download(row.photo_path as string);
    if (error || !data) return NextResponse.json({ error: "写真を読めませんでした。" }, { status: 502 });
    return new NextResponse(data, { headers: { "content-type": data.type || "image/jpeg", "cache-control": "no-store" } });
  }

  const { data, error } = await admin
    .from("cost_purchases")
    .select("id, book_date, created_at")
    .eq("status", "pending")
    .order("created_at")
    .limit(30);
  if (error) return NextResponse.json({ error: "読み出せませんでした。" }, { status: 500 });
  const { count } = await admin.from("cost_purchases").select("id", { count: "exact", head: true }).eq("status", "pending");
  return NextResponse.json({
    today: todayBizDate(),
    remaining: count ?? data.length,
    items: data.map((r) => ({ id: r.id, taken_on: r.book_date, uploaded_at: r.created_at, photo: `/api/cost/reader?photo=${r.id}` })),
  });
}

export async function POST(request: Request) {
  if (!(await verifyApiToken(NAME, request.headers.get("x-api-key")))) return deny();
  let body: { id?: unknown; doc?: unknown; unreadable?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON ではありません。" }, { status: 400 });
  }
  const id = typeof body.id === "string" && ID_RE.test(body.id) ? body.id : null;
  if (!id) return NextResponse.json({ error: "id が不正です。" }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin.from("cost_purchases").select("status, book_date").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "その写真はありません（消された可能性）。" }, { status: 404 });
  if (row.status !== "pending") return NextResponse.json({ ok: true, skipped: "読み取り待ちではありません（人が先に入れた）" });

  const now = new Date().toISOString();
  let update: Record<string, unknown>;
  if (typeof body.unreadable === "string") {
    update = { status: "unconfirmed", vendor: "（読み取れず）", ai_read: true, ai_note: `読み取れませんでした：${body.unreadable}`.slice(0, 500), read_at: now };
  } else {
    const parsed = parseAiDoc(body.doc);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    // 日付が読めなければ撮った日で計上する
    const d = draftFromAi(parsed.doc, row.book_date as string);
    update = {
      status: "unconfirmed",
      doc_kind: d.doc_kind,
      vendor: d.vendor,
      book_date: d.book_date,
      period_from: d.doc_kind === "invoice" ? d.period_from : null,
      period_to: d.doc_kind === "invoice" ? d.period_to : null,
      food_ex: d.food_ex,
      drink_ex: d.drink_ex,
      supplies_ex: d.supplies_ex,
      other_ex: d.other_ex,
      total_in: d.total_in,
      ai_read: true,
      ai_note: d.note || null,
      read_at: now,
    };
  }
  const { error } = await admin.from("cost_purchases").update(update).eq("id", id).eq("status", "pending");
  if (error) return NextResponse.json({ error: `保存できませんでした：${error.message}` }, { status: 400 });
  revalidatePath("/sales/cost");
  return NextResponse.json({ ok: true });
}
