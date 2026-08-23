import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 2026-02-31 のような「形は正しいが存在しない日」を弾く（正規表現は通ってしまう） */
function isRealDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

type IngestDay = {
  date: string;
  actual_yen?: number;
  target_yen?: number;
  /** 消費税10%対象＝店内飲食 */
  tax10_yen?: number;
  /** 消費税8%対象＝持ち帰り＝物販 */
  tax8_yen?: number;
  /** 客数（エアレジの日別売上より） */
  guest_count?: number;
  /** 会計数＝伝票の枚数（おおよその組数） */
  check_count?: number;
};

/**
 * 売上の取り込み口。しっぽり亭週次レポート（別リポジトリ）が
 * エアレジから取った日毎の実績を、ここに POST して流し込む。
 *
 *   POST /api/sales/ingest
 *   ヘッダー: x-api-key: <SALES_INGEST_TOKEN>
 *   本文: { "days": [ { "date": "2026-08-08", "actual_yen": 58000 }, ... ] }
 *
 * 税率別も送れる（エアレジの税率別集計から）。日本の消費税は
 * 店内で食べれば10%・持ち帰れば8%なので、これがそのまま
 * 「店内飲食」と「物販」の境目になる。
 *
 *   { "date": "2026-07-26", "tax10_yen": 57830, "tax8_yen": 623000 }
 *
 * 客数・会計数も送れる（エアレジの同じ表に並んでいる）。客単価は保存しない——
 * 割り算はアプリの1か所でやる。保存した平均は実績を直したときに置いていかれる。
 *
 *   { "date": "2026-08-08", "actual_yen": 58000, "guest_count": 22, "check_count": 8 }
 *
 * actual_yen を省いて税率別だけ送った場合は、合計を実績として扱う。
 * target_yen も渡せば目標の一括投入にも使える。
 * 渡さなかった項目は既存の値を保つ（上書きしない）。
 */
export async function POST(request: Request) {
  const token = process.env.SALES_INGEST_TOKEN;
  if (!token || request.headers.get("x-api-key") !== token) {
    return NextResponse.json({ error: "認証できません。" }, { status: 401 });
  }

  let body: { days?: IngestDay[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "本文がJSONではありません。" }, { status: 400 });
  }

  const days = Array.isArray(body.days) ? body.days : [];
  if (days.length === 0 || days.length > 400) {
    return NextResponse.json({ error: "days は 1〜400 件で送ってください。" }, { status: 400 });
  }
  const seen = new Set<string>();
  for (const d of days) {
    if (!DATE_RE.test(d.date ?? "") || !isRealDate(d.date)) {
      return NextResponse.json({ error: `日付が不正です: ${d.date}` }, { status: 400 });
    }
    // 同じ日付が2回入っていると upsert が
    // 「ON CONFLICT DO UPDATE cannot affect row a second time」で丸ごと落ちる。
    // 400件のバッチが1件の重複で全滅するので、ここで日付を名指しして止める。
    if (seen.has(d.date)) {
      return NextResponse.json({ error: `日付が重複しています: ${d.date}` }, { status: 400 });
    }
    seen.add(d.date);

    for (const v of [d.actual_yen, d.target_yen, d.tax10_yen, d.tax8_yen]) {
      if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > 100_000_000)) {
        return NextResponse.json({ error: `金額が不正です: ${d.date}` }, { status: 400 });
      }
    }
    // 人数は桁が違う。金額と同じ上限で見ると、1万人を超える取り違えを素通しする
    for (const v of [d.guest_count, d.check_count]) {
      if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > 10_000)) {
        return NextResponse.json({ error: `人数が不正です: ${d.date}` }, { status: 400 });
      }
    }

    // 税率別と実績の突き合わせ。
    // service role で直接書くので DB関数 set_sales_retail の検査は一度も通らない。
    // 10%と8%を取り違えて送られても素通りしてしまうので、ここが唯一の防波堤になる。
    const bothRates = d.tax10_yen !== undefined && d.tax8_yen !== undefined;
    if (d.actual_yen !== undefined) {
      if (d.tax8_yen !== undefined && d.tax8_yen > d.actual_yen) {
        return NextResponse.json(
          { error: `物販が実績を超えています: ${d.date}` },
          { status: 400 },
        );
      }
      if (bothRates) {
        const gap = Math.abs(d.tax10_yen! + d.tax8_yen! - d.actual_yen);
        // 商品券や0%対象で多少ずれるのは通す。桁違いのずれは取り違えを疑う。
        if (gap > Math.max(1000, d.actual_yen * 0.02)) {
          return NextResponse.json(
            { error: `税率別の合計が実績と合いません: ${d.date}` },
            { status: 400 },
          );
        }
      }
    }
  }

  const admin = createAdminClient();

  // 渡されなかった項目は保つため、既存行を読んでからまとめて upsert する
  const dates = days.map((d) => d.date);
  const { data: existing, error: readError } = await admin
    .from("sales_daily")
    .select("biz_date, target_yen, actual_yen, tax10_yen, tax8_yen, guest_count, check_count")
    .in("biz_date", dates);
  if (readError) {
    return NextResponse.json({ error: "読み込みに失敗しました。" }, { status: 500 });
  }

  type Row = {
    target_yen: number | null;
    actual_yen: number | null;
    tax10_yen: number | null;
    tax8_yen: number | null;
    guest_count: number | null;
    check_count: number | null;
  };
  const current = new Map((existing ?? []).map((r) => [r.biz_date as string, r as Row]));
  const rows = days.map((d) => {
    const prev = current.get(d.date);
    const tax10 = d.tax10_yen ?? prev?.tax10_yen ?? null;
    const tax8 = d.tax8_yen ?? prev?.tax8_yen ?? null;
    // 税率別だけ送られてきた日は、その合計を実績として扱う
    const summed =
      d.actual_yen === undefined && d.tax10_yen !== undefined && d.tax8_yen !== undefined
        ? d.tax10_yen + d.tax8_yen
        : undefined;
    return {
      biz_date: d.date,
      target_yen: d.target_yen ?? prev?.target_yen ?? null,
      actual_yen: d.actual_yen ?? summed ?? prev?.actual_yen ?? null,
      tax10_yen: tax10,
      tax8_yen: tax8,
      guest_count: d.guest_count ?? prev?.guest_count ?? null,
      check_count: d.check_count ?? prev?.check_count ?? null,
    };
  });

  // 実績だけ送り直して下げると、前に入っていた物販がそのまま残って
  // 「店内＝実績−物販」が負になる。混ぜたあとの形でもう一度見る。
  for (const r of rows) {
    if (r.actual_yen != null && r.tax8_yen != null && r.tax8_yen > r.actual_yen) {
      return NextResponse.json(
        { error: `物販が実績を超えます（前に入っていた物販が残っています）: ${r.biz_date}` },
        { status: 400 },
      );
    }
  }

  const { error } = await admin.from("sales_daily").upsert(rows, { onConflict: "biz_date" });
  if (error) {
    return NextResponse.json({ error: "保存に失敗しました。" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
