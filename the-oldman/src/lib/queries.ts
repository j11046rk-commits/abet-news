import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  ExclusiveHours,
  FixedCost,
  LedgerEntry,
  CheckIn,
  MonthlySummary,
  Profile,
  Reservation,
  Session,
  SessionStats,
  Settings,
} from "@/lib/types";

/** 施設設定。行が無い場合も画面を落とさないよう既定値を返す。 */
export async function getSettings(): Promise<Settings> {
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("*").eq("id", true).maybeSingle<Settings>();
  return (
    data ?? {
      id: true,
      facility_name: "The Oldman",
      monthly_target_yen: 100000,
      owner_count: 6,
      rake_rule: null,
    }
  );
}

export async function getProfiles(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .order("role", { ascending: true })
    .order("joined_on", { ascending: true });
  return (data ?? []) as Profile[];
}

export async function getProfileMap(): Promise<Map<string, Profile>> {
  return new Map((await getProfiles()).map((p) => [p.id, p]));
}

/** 期間内の予約。カレンダー用。 */
export async function getReservationsBetween(fromIso: string, toIso: string): Promise<Reservation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reservations")
    .select("*")
    .lt("starts_at", toIso)
    .gt("ends_at", fromIso)
    .order("starts_at");
  return (data ?? []) as Reservation[];
}

export async function getUpcomingReservations(limit = 60): Promise<Reservation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reservations")
    .select("*")
    .gte("ends_at", new Date().toISOString())
    .order("starts_at")
    .limit(limit);
  return (data ?? []) as Reservation[];
}

export async function getPastReservations(limit = 30): Promise<Reservation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reservations")
    .select("*")
    .lt("ends_at", new Date().toISOString())
    .order("starts_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Reservation[];
}

export async function getReservation(id: string): Promise<Reservation | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("reservations").select("*").eq("id", id).maybeSingle<Reservation>();
  return data ?? null;
}

/* ── セッション ─────────────────────────────────────────────────────── */

export async function getSessions(limit = 60): Promise<Session[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sessions")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Session[];
}

export async function getSessionStats(): Promise<SessionStats> {
  const supabase = await createClient();
  const { data } = await supabase.from("v_session_stats").select("*").maybeSingle<SessionStats>();
  return (
    data ?? {
      session_count: 0,
      avg_rake_yen: 0,
      avg_rake_90d_yen: 0,
      sessions_last_30d: 0,
      total_rake_yen: 0,
      last_session_at: null,
    }
  );
}

/* ── 台帳 ───────────────────────────────────────────────────────────── */

export async function getLedgerEntries(limit = 200): Promise<LedgerEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ledger_entries")
    .select("*")
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as LedgerEntry[];
}

export async function getMonthlySummary(): Promise<MonthlySummary[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("v_monthly_summary").select("*").order("ym");
  return (data ?? []) as MonthlySummary[];
}

export async function getFixedCosts(): Promise<FixedCost[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("fixed_costs").select("*").order("billing_day");
  return (data ?? []) as FixedCost[];
}

/* ── 貸切時間 ───────────────────────────────────────────────────────── */

export async function getExclusiveHours(): Promise<ExclusiveHours[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("v_exclusive_hours").select("*");
  return (data ?? []).map((r) => ({
    profile_id: (r as ExclusiveHours).profile_id,
    ym: (r as ExclusiveHours).ym,
    exclusive_hours: Number((r as ExclusiveHours).exclusive_hours ?? 0),
    shared_hours: Number((r as ExclusiveHours).shared_hours ?? 0),
  }));
}


/* ── チェックイン ───────────────────────────────────────────────────── */

/** いま施設にいる人（滞在中の行） */
export async function getOpenCheckIns(): Promise<CheckIn[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("check_ins")
    .select("*")
    .is("checked_out_at", null)
    .order("checked_in_at", { ascending: true });
  return (data ?? []) as CheckIn[];
}

/** 直近の出入り */
export async function getRecentCheckIns(limit = 12): Promise<CheckIn[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("check_ins")
    .select("*")
    .order("checked_in_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as CheckIn[];
}

/** 自分がいま滞在中かどうか */
export async function getMyOpenCheckIn(profileId: string): Promise<CheckIn | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("check_ins")
    .select("*")
    .eq("profile_id", profileId)
    .is("checked_out_at", null)
    .maybeSingle<CheckIn>();
  return data ?? null;
}
