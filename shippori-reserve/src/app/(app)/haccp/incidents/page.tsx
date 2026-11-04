import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/constants";
import { getAllProfiles } from "@/lib/queries";
import { shiftDate, todayBizDate } from "@/lib/time";
import { getIncidents, getPlans } from "@/lib/haccp-data";
import HaccpTabs from "../HaccpTabs";
import IncidentList from "./IncidentList";

export const dynamic = "force-dynamic";

/** 異常と改善対応。対応中を上に、対応済みは直近60日 */
export default async function IncidentsPage() {
  const me = await requirePermission("haccp.record");
  const today = todayBizDate();
  const [open, recent, plans, profiles] = await Promise.all([
    getIncidents({ openOnly: true }),
    getIncidents({ from: shiftDate(today, -60) }),
    getPlans(),
    getAllProfiles(),
  ]);
  const done = recent.filter((i) => i.status === "done");
  // 計画に書いた「問題があったとき」「基準を満たさないとき」を、対応の目安として出す
  const guides: Record<string, string> = {};
  for (const p of plans) {
    for (const g of p.content.general) guides[`${p.id}:gen:${g.key}`] = g.onProblem;
    for (const m of p.content.menus) guides[`${p.id}:menu:${m.id}`] = m.onFail;
    for (const k of ["g1", "g2", "g3"] as const) guides[`${p.id}:cc:${k}`] = p.content.cc[k].onProblem;
  }
  return (
    <>
      <header className="appbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-face-96.png" alt="しっぽり亭" width={96} height={96} className="appbar__logo" />
        <div className="appbar__title">異常・改善対応</div>
      </header>
      <HaccpTabs current="incidents" canManage={can(me.role, "haccp.manage")} />
      <IncidentList
        open={open}
        done={done}
        today={today}
        canManage={can(me.role, "haccp.manage")}
        staff={profiles.filter((p) => p.is_active && p.role !== "viewer").map((p) => ({ id: p.id, name: p.display_name }))}
        names={Object.fromEntries(profiles.map((p) => [p.id, p.display_name]))}
        guides={guides}
      />
      <div style={{ height: "4rem" }} />
    </>
  );
}
