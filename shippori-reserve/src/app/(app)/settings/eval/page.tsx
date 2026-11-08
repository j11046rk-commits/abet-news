import Link from "next/link";
import { redirect } from "next/navigation";
import StoreEvalCard from "@/components/StoreEvalCard";
import { requireProfile } from "@/lib/auth";
import { worksShifts } from "@/lib/constants";
import { getAllProfiles, getSettings } from "@/lib/queries";
import { getMonthEval, getOpenStarRequests, getStarRows } from "@/lib/store-eval-data";
import { pointsOf, rankOf, starsAvailable, targetsFrom } from "@/lib/store-eval";
import { fmtYm, shiftMonth, todayBizDate } from "@/lib/time";
import EvalTargetsForm from "./EvalTargetsForm";
import StarAdmin from "./StarAdmin";
import LaborCostForm from "./LaborCostForm";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * 評価（店長・オーナーだけ・店主指定 2026-11-09）。
 *   ・店舗評価のリアルタイム（今月）と、直近6か月の推移・平均
 *   ・昇給の基準（素案を店主と相談中。決まったらここに出す）
 *   ・目標（オーナーが変える）
 *   ・達成貢献⭐：全員の累計と交換の申請（「交換しました」を押す）
 */
export default async function EvalPage() {
  const me = await requireProfile();
  if (me.role !== "owner" && me.role !== "manager") redirect("/settings");
  const today = todayBizDate();
  const settings = await getSettings();
  const targets = targetsFrom(settings);
  const thisYm = fmtYm(today);
  const yms = Array.from({ length: 6 }, (_, i) => fmtYm(shiftMonth(`${thisYm}-01`, -i)));
  const supabase = await createClient();
  const [evals, profiles, stars, requests, { data: lcRows }] = await Promise.all([
    Promise.all(yms.map((ym) => getMonthEval(ym, today, targets))),
    getAllProfiles(),
    getStarRows(),
    getOpenStarRequests(),
    supabase.from("labor_cost_monthly").select("ym, total_yen").in("ym", yms),
  ]);
  const lcBy = new Map((lcRows ?? []).map((r) => [r.ym as string, r.total_yen as number]));
  const scored = evals.filter((e) => e.score != null);
  const avg = scored.length ? Math.round((scored.reduce((a, e) => a + e.score!, 0) / scored.length) * 10) / 10 : null;
  const name = new Map(profiles.map((p) => [p.id, p.display_name]));
  const people = profiles
    .filter((p) => p.is_active && worksShifts(p.role))
    .map((p) => {
      const r = stars.get(p.id);
      return {
        id: p.id,
        name: p.display_name,
        earned: r?.earned ?? 0,
        used: r?.used ?? 0,
        requested: r?.requested ?? 0,
        available: starsAvailable(r?.earned ?? 0, r?.used ?? 0, r?.requested ?? 0),
      };
    })
    .sort((a, b) => b.earned - a.earned);
  // 表は「点」で並べる（目標どおり＝100点）。率（%）は下の「人件費（月の合計）」とカードに出す
  const pts = (e: (typeof evals)[number], k: string) => {
    const p = pointsOf(e.metrics.find((x) => x.key === k)?.rate ?? null);
    return p != null ? String(p) : "—";
  };

  return (
    <>
      <header className="appbar">
        <Link className="btn btn-sm" href="/settings" aria-label="設定へ戻る">
          ‹
        </Link>
        <div>
          <div className="appbar__title">評価</div>
          <div className="appbar__sub">店長・オーナーだけ</div>
        </div>
      </header>

      <div className="wrap stack">
        <StoreEvalCard e={evals[0]!} title={`${Number(thisYm.slice(5))}月・今日まで`} />

        <section className="card" aria-label="直近6か月">
          <h2 className="section-title">直近6か月</h2>
          <table className="eval-table">
            <thead>
              <tr>
                <th>月</th>
                <th>売上</th>
                <th>原価</th>
                <th>人件費</th>
                <th>LINE</th>
                <th>人時</th>
                <th>評価</th>
              </tr>
            </thead>
            <tbody>
              {evals.map((e) => (
                <tr key={e.ym}>
                  <td>
                    {Number(e.ym.slice(5))}月{e.current ? "（途中）" : ""}
                  </td>
                  <td>{pts(e, "sales")}</td>
                  <td>{pts(e, "cost")}</td>
                  <td>{pts(e, "labor")}</td>
                  <td>{pts(e, "line")}</td>
                  <td>{pts(e, "perhour")}</td>
                  <td>{e.score != null ? `${e.score.toFixed(1)} ${e.rank}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="micro" style={{ marginTop: "0.5rem" }}>
            数字はすべて点（目標どおり＝100点）。6か月の平均：{avg != null ? `${avg}点（${rankOf(avg)}）` : "—"}。人件費は月の合計を入れた月は実際の率、入れていない月は推定。原価は棚卸が2回そろった月から入ります。
          </p>
        </section>

        <section className="card stack" aria-label="昇給">
          <h2 className="section-title">昇給（店長）</h2>
          <p className="micro">昇給の決め方は、いま店主と相談中です。決まったら、ここに半年の平均点から昇給の目安が出ます。</p>
        </section>

        <LaborCostForm
          canEdit={me.role === "owner"}
          rows={evals.map((e) => ({ ym: e.ym, total: lcBy.get(e.ym) ?? null, ratio: e.metrics.find((m) => m.key === "labor")?.actual ?? "—" }))}
        />

        <EvalTargetsForm targets={targets} canEdit={me.role === "owner"} />

        <StarAdmin
          isOwner={me.role === "owner"}
          enabled={settings.star_exchange_enabled === true}
          people={people}
          requests={requests.map((r) => ({ ...r, name: name.get(r.profileId) ?? "（不明）" }))}
        />
        <div style={{ height: "2rem" }} />
      </div>
    </>
  );
}
