import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BACKUP_LAST_KEY } from "@/lib/backup-watch";

/**
 * まるごと書き出し（バックアップ）。
 *
 * Supabase の無料プランにはバックアップが無い。つまり予約・売上・シフト・
 * スタッフの全部が、この世に1か所しか無い状態だった。誤操作1回、
 * プロジェクトの事故1回で、開業以来の記録が戻せなくなる。
 *
 * ここは「読み出し口」だけを用意する。**保存先はこのサーバーではない**——
 * 同じ場所に置いた控えは、その場所ごと失うときに一緒に消えるので控えにならない。
 * 店主のMacの週次レポートが週1回ここを叩き、手元（とiCloud）にJSONで置く。
 *
 * ★合言葉は専用のものを使う（BACKUP_TOKEN）。
 *   ここは全テーブルを平文で返す口なので、service_role キーとほぼ同じ重さがある。
 *   既にMacにある SALES_INGEST_TOKEN を使い回せば設定は要らないが、
 *   あれは「売上の数字を書き込むだけ」の鍵として渡したもの。
 *   同じ鍵で全予約の氏名と電話番号が抜けるようにするのは、渡した意味が変わる。
 *   手元にコピーする手間を1回だけ払って、鍵は分けておく。
 *
 *   Vercel の定期実行から呼ぶ道も開けてある（Authorization: Bearer CRON_SECRET）。
 *   ただし**その道は使っていない**——Vercelから呼んでも保存先がVercelになってしまい、
 *   「同じ場所に置いた控え」になるため。呼ぶのは店主のMacから。
 *
 *   どちらも未設定なら**動かさない**（合言葉なしで開いたままにしない）。
 */

/** 書き出す順番＝復元する順番。参照される側を先に置く（profiles → 予約 …） */
const TABLES = [
  "settings",
  "permissions",
  "role_permissions",
  "profiles",
  "courses",
  "seat_units",
  "seat_slots",
  "business_days",
  "reservations",
  "shift_requests",
  "shift_request_submissions",
  "shifts",
  "shift_publications",
  "sales_daily",
  "sales_monthly",
  "seat_board",
  "seat_log",
  "line_friends",
  "line_broadcasts",
  "net_pause",
  "reference_counters",
  // 衛生管理（0064）。計画→記録→異常→振り返りの順＝参照される側が先
  "haccp_plans",
  "haccp_plan_notices",
  "haccp_plan_acks",
  "haccp_checks",
  "haccp_batches",
  "haccp_incidents",
  "haccp_day_closes",
  "haccp_reviews",
  "haccp_revisions",
  "haccp_sensors",
  "haccp_temp_readings",
  "cost_purchases",
  "cost_stock_items",
  "cost_stock_locations",
  "cost_stocktakes",
  "cost_stock_counts",
  "cost_losses",
  "star_redemptions",
  "labor_cost_monthly",
  "labor_cost_daily",
  // 2026-11-13 追加。あとから増えた表が書き出しから漏れていた
  "labor_daily",
  "timecard_issues",
  "review_requests", // 口コミのお願いを誰に送ったか（180日に1回の歯止め）。reservations より後
  "line_followers_daily",
  "weather_daily",
  "jp_holidays",
  "audit_logs",
] as const;

/*
 * ★わざと書き出さない表（表を足したときは、ここか上のどちらかに必ず書く）
 *   integration_tokens / api_tokens … 鍵そのもの（freeeの更新トークンなど）。控えに平文で置かない。
 *                                     戻すときは freee をつなぎ直し、トークンを発行し直す
 *   line_messages     … お客様のトーク。30日で消す約束で、控えは13か月残るので入れない
 *   public_attempts   … レート制限用の試行記録（IPを含む）。戻す意味が無い
 *   haccp_sensor_alerts … 「いま知らせ済みか」の一時的な状態
 *   hp_dashboard      … 公式サイトのビルドが作り直す
 *   app_migrations    … migrate.mjs が管理する
 */

/** PostgREST は1回1000行までなので、終わりが来るまで足していく */
const PAGE = 1000;

export async function GET(request: Request) {
  const backupToken = process.env.BACKUP_TOKEN;
  const cronSecret = process.env.CRON_SECRET;
  const byToken = !!backupToken && request.headers.get("x-api-key") === backupToken;
  const byCron = !!cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`;
  if (!byToken && !byCron) {
    return NextResponse.json({ error: "認証できません。" }, { status: 401 });
  }

  const admin = createAdminClient();
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  const failed: string[] = [];

  for (const table of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from(table)
        .select("*")
        .range(from, from + PAGE - 1);
      if (error) {
        // 1つのテーブルで転んでも、残りは書き出す。
        // 「全部か無か」にすると、テーブルを1つ増やした日にバックアップが丸ごと止まる。
        console.error("backup_table_failed", table, error.message);
        failed.push(table);
        break;
      }
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    tables[table] = rows;
    counts[table] = rows.length;
  }

  /*
   * Macが控えを取りに来た時刻を残す（lib/backup-watch.ts がこれを見て、止まっていたら知らせる）。
   * 予約が1件も読めていないときは残さない——Mac側も「空の控え」は失敗として捨てるので、
   * ここだけ「取れた」ことにすると、止まっているのに見張りが黙る。
   * Vercelの定期実行の道（byCron）では残さない。あちらは手元に控えが置かれないため。
   */
  if (byToken && (counts.reservations ?? 0) > 0) {
    const { error: markErr } = await admin
      .from("settings")
      .upsert({ key: BACKUP_LAST_KEY, value: new Date().toISOString() });
    if (markErr) console.error("backup_mark_failed", markErr.message);
  }

  // 落ちたテーブルがあることは、静かに済ませない。呼んだ側が気づけるように形で返す。
  return NextResponse.json(
    {
      ok: failed.length === 0,
      at: new Date().toISOString(),
      // 復元する側が「どの順に入れれば外部キーで転ばないか」を迷わないように
      order: TABLES,
      failed,
      counts,
      tables,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
