/**
 * 眠り覚ましの的。
 *
 * Vercel の関数はしばらく呼ばれないと眠り、次の1人がコールドスタート
 * （2秒前後）を踏む。夜しか使われないこのサイトでは、ほぼ毎回それが
 * 「初回起動が遅い」として現れる。Supabase の pg_cron が数分おきに
 * ここを叩いて、関数を起こしたままにする（0017_keep_warm.sql）。
 *
 * DB にも認証にも触れない。仕事は「関数を実行状態にする」ことだけ。
 */
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", { headers: { "cache-control": "no-store" } });
}
