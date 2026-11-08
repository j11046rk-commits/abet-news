import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyApiToken } from "@/lib/api-token";
import { COST_BUCKET } from "@/lib/cost-data";
import { draftFromAi, isPdfPath, parseAiDoc, parseAiLoss, type PurchaseDraft } from "@/lib/cost";
import { todayBizDate } from "@/lib/time";

/**
 * 原価の写真・PDFの読み取り口。読むのは定期実行の Claude（サブスクのセッション）で、API料金は使わない。
 * 守りは x-api-key（オーナーが画面で発行する合言葉・名前 cost_reader）。
 *
 *   GET  /api/cost/reader              … 読み取り待ちの一覧（古い順・最大30件ずつ）
 *        items[].kind = "purchase"（仕入の書類）| "loss"（捨てたもの）。file = "image" | "pdf"
 *        stock_items … 棚卸の品目と税抜の単価（ロスの金額の目安に使う）
 *   GET  /api/cost/reader?photo=<id>   … その写真・PDFそのもの
 *   POST /api/cost/reader              … 読んだ結果を返す
 *        仕入：{ "id", "doc": {...} }。1つのPDFに書類が何枚もあるときは { "id", "docs": [{...}, ...] }（1枚＝1行に分ける）
 *        ロス：{ "id", "loss": { item, amount_ex（仕入値の目安・税抜・円）, reason, note } }
 *        読めなかったとき：{ "id", "unreadable": "理由" }（人が手で入れる行になる）
 *
 * 結果は「未確認」として入る（原価率・ロスの合計には入る）。人が見比べて「確認した」か「直す」。
 */

const NAME = "cost_reader";
const ID_RE = /^[0-9a-f-]{36}$/;
const deny = () => NextResponse.json({ error: "認証できません。" }, { status: 401 });

type Kind = "purchase" | "loss";
const TABLE: Record<Kind, string> = { purchase: "cost_purchases", loss: "cost_losses" };

async function findRow(id: string): Promise<{ kind: Kind; row: Record<string, unknown> } | null> {
  const admin = createAdminClient();
  for (const kind of ["purchase", "loss"] as Kind[]) {
    const cols = kind === "purchase" ? "status, book_date, photo_path, created_by" : "status, biz_date, photo_path, memo";
    const { data } = await admin.from(TABLE[kind]).select(cols).eq("id", id).maybeSingle();
    if (data) return { kind, row: data as unknown as Record<string, unknown> };
  }
  return null;
}

export async function GET(request: Request) {
  if (!(await verifyApiToken(NAME, request.headers.get("x-api-key")))) return deny();
  const admin = createAdminClient();
  const photo = new URL(request.url).searchParams.get("photo");

  if (photo) {
    if (!ID_RE.test(photo)) return NextResponse.json({ error: "id が不正です。" }, { status: 400 });
    const found = await findRow(photo);
    const path = found?.row.photo_path as string | undefined;
    if (!path) return NextResponse.json({ error: "写真がありません。" }, { status: 404 });
    const { data, error } = await admin.storage.from(COST_BUCKET).download(path);
    if (error || !data) return NextResponse.json({ error: "写真を読めませんでした。" }, { status: 502 });
    const type = isPdfPath(path) ? "application/pdf" : data.type || "image/jpeg";
    return new NextResponse(data, { headers: { "content-type": type, "cache-control": "no-store" } });
  }

  const [pur, los, items, c1, c2] = await Promise.all([
    admin.from("cost_purchases").select("id, book_date, created_at, photo_path").eq("status", "pending").order("created_at").limit(30),
    admin.from("cost_losses").select("id, biz_date, created_at, photo_path, memo").eq("status", "pending").order("created_at").limit(30),
    admin.from("cost_stock_items").select("name, unit, unit_price, category").eq("active", true).order("sort"),
    admin.from("cost_purchases").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("cost_losses").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  if (pur.error || los.error) return NextResponse.json({ error: "読み出せませんでした。" }, { status: 500 });
  return NextResponse.json({
    today: todayBizDate(),
    remaining: { purchase: c1.count ?? 0, loss: c2.count ?? 0 },
    items: [
      ...(pur.data ?? []).map((r) => ({
        kind: "purchase" as const,
        id: r.id,
        taken_on: r.book_date,
        uploaded_at: r.created_at,
        file: isPdfPath(r.photo_path as string) ? "pdf" : "image",
        photo: `/api/cost/reader?photo=${r.id}`,
      })),
      ...(los.data ?? []).map((r) => ({
        kind: "loss" as const,
        id: r.id,
        taken_on: r.biz_date,
        uploaded_at: r.created_at,
        file: "image",
        memo: r.memo,
        photo: `/api/cost/reader?photo=${r.id}`,
      })),
    ],
    stock_items: items.data ?? [],
  });
}

const purchaseUpdate = (d: PurchaseDraft, now: string) => ({
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
});

export async function POST(request: Request) {
  if (!(await verifyApiToken(NAME, request.headers.get("x-api-key")))) return deny();
  let body: { id?: unknown; doc?: unknown; docs?: unknown; loss?: unknown; unreadable?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON ではありません。" }, { status: 400 });
  }
  const id = typeof body.id === "string" && ID_RE.test(body.id) ? body.id : null;
  if (!id) return NextResponse.json({ error: "id が不正です。" }, { status: 400 });

  const found = await findRow(id);
  if (!found) return NextResponse.json({ error: "その写真はありません（消された可能性）。" }, { status: 404 });
  const { kind, row } = found;
  if (row.status !== "pending") return NextResponse.json({ ok: true, skipped: "読み取り待ちではありません（人が先に入れた）" });

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const unreadable = typeof body.unreadable === "string" ? `読み取れませんでした：${body.unreadable}`.slice(0, 500) : null;

  if (kind === "loss") {
    let update: Record<string, unknown>;
    if (unreadable) {
      update = { status: "unconfirmed", item: "（読み取れず）", amount_ex: 0, reason: "other", ai_note: unreadable, read_at: now };
    } else {
      const parsed = parseAiLoss(body.loss);
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
      const l = parsed.loss;
      update = { status: "unconfirmed", item: l.item, amount_ex: l.amount_ex, reason: l.reason, ai_note: l.note || null, read_at: now };
    }
    const { error } = await admin.from("cost_losses").update(update).eq("id", id).eq("status", "pending");
    if (error) return NextResponse.json({ error: `保存できませんでした：${error.message}` }, { status: 400 });
    revalidatePath("/sales/cost");
    return NextResponse.json({ ok: true });
  }

  if (unreadable) {
    const { error } = await admin
      .from("cost_purchases")
      .update({ status: "unconfirmed", vendor: "（読み取れず）", ai_read: true, ai_note: unreadable, read_at: now })
      .eq("id", id)
      .eq("status", "pending");
    if (error) return NextResponse.json({ error: `保存できませんでした：${error.message}` }, { status: 400 });
    revalidatePath("/sales/cost");
    return NextResponse.json({ ok: true });
  }

  const raw = Array.isArray(body.docs) ? body.docs : body.doc !== undefined ? [body.doc] : [];
  if (raw.length === 0 || raw.length > 60) return NextResponse.json({ error: "doc（1件）か docs（1〜60件）を送ってください" }, { status: 400 });
  const drafts: PurchaseDraft[] = [];
  for (const [i, d] of raw.entries()) {
    const parsed = parseAiDoc(d);
    if (!parsed.ok) return NextResponse.json({ error: `${raw.length > 1 ? `${i + 1}件目：` : ""}${parsed.error}` }, { status: 400 });
    // 日付が読めなければ撮った日で計上する
    drafts.push(draftFromAi(parsed.doc, row.book_date as string));
  }
  // 1件目は今の行に、2件目からは同じファイルを指す行を足す（1つのPDFに書類が何枚もあるとき）
  const { error } = await admin.from("cost_purchases").update(purchaseUpdate(drafts[0]!, now)).eq("id", id).eq("status", "pending");
  if (error) return NextResponse.json({ error: `保存できませんでした：${error.message}` }, { status: 400 });
  if (drafts.length > 1) {
    const extra = drafts.slice(1).map((d) => ({ ...purchaseUpdate(d, now), photo_path: row.photo_path, created_by: row.created_by ?? null }));
    const { error: e2 } = await admin.from("cost_purchases").insert(extra);
    if (e2) return NextResponse.json({ error: `1件目は保存、2件目以降で止まりました：${e2.message}` }, { status: 400 });
  }
  revalidatePath("/sales/cost");
  return NextResponse.json({ ok: true, rows: drafts.length });
}
