import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  Advance,
  ExclusiveHours,
  FixedCost,
  LedgerEntry,
  CheckIn,
  MonthlySummary,
  PassbookRow,
  Profile,
  Reservation,
  Session,
  SessionStats,
  Settings,
  WishlistItem,
  WishlistItemView,
} from "@/lib/types";
import { METERED_CATEGORIES } from "@/lib/types";

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
      utilities_alert_from: "2026-09",
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

/**
 * 通帳の1ヶ月ぶん。古い順に並べ、前月末の残高から積み上げた残高を各行に載せる。
 *
 * 前月末の残高は「その月より前のすべての行の収支」であって、v_monthly_summary の
 * 直前の月の balance_yen とは限らない（記帳の無い月が挟まると行が飛ぶ）。
 * ym より小さい最後の行を取るので、飛んでいても正しい。
 */
export async function getPassbook(
  ym: string,
): Promise<{ opening: number; rows: PassbookRow[] }> {
  const supabase = await createClient();
  const [{ data: entries }, { data: months }] = await Promise.all([
    supabase
      .from("ledger_entries")
      .select("*")
      .gte("entry_date", `${ym}-01`)
      .lt("entry_date", nextYm(ym) + "-01")
      .order("entry_date", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("v_monthly_summary")
      .select("ym, balance_yen")
      .lt("ym", ym)
      .order("ym", { ascending: false })
      .limit(1),
  ]);

  const opening = (months?.[0] as { balance_yen: number } | undefined)?.balance_yen ?? 0;

  let running = opening;
  const rows = ((entries ?? []) as LedgerEntry[]).map((e) => {
    running += e.direction === "income" ? e.amount_yen : -e.amount_yen;
    return { ...e, balance_yen: running };
  });

  return { opening, rows };
}

/** 記帳のある年月を新しい順に。通帳の月送りで、空の月を飛ばすために使う。 */
export async function getLedgerMonths(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("v_monthly_summary")
    .select("ym")
    .order("ym", { ascending: false });
  return ((data ?? []) as { ym: string }[]).map((r) => r.ym);
}

function nextYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** その月に記帳済みのメーター費目（水道代・電気代）のカテゴリ集合。 */
export async function getMeteredPosted(ym: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ledger_entries")
    .select("category")
    .eq("direction", "expense")
    .in("category", METERED_CATEGORIES.map((c) => c.value))
    .gte("entry_date", `${ym}-01`)
    .lt("entry_date", nextYm(ym) + "-01");
  return new Set(((data ?? []) as { category: string }[]).map((r) => r.category));
}

export async function getFixedCosts(): Promise<FixedCost[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("fixed_costs").select("*").order("billing_day");
  return (data ?? []) as FixedCost[];
}

/* ── 立替 ───────────────────────────────────────────────────────────── */

/** 未精算を先に、そのなかは精算予定日の早い順。返す約束が近いものから見せる。 */
export async function getAdvances(limit = 60): Promise<Advance[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("advances")
    .select("*")
    .order("settled_at", { ascending: true, nullsFirst: true })
    .order("due_on", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Advance[];
}

/* ── ほしい物リスト ─────────────────────────────────────────────────── */

/**
 * 画像は非公開バケットに置いてあるので、都度署名URLを作って渡す。
 * 有効期限は1時間 — 画面を開いている間だけ見えれば足りる。
 */
export async function getWishlist(limit = 100): Promise<WishlistItemView[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("wishlist_items")
    .select("*")
    .order("bought_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(limit);

  const items = (data ?? []) as WishlistItem[];
  const paths = items.map((i) => i.image_path).filter((p): p is string => Boolean(p));
  if (paths.length === 0) return items.map((i) => ({ ...i, image_url: null }));

  const { data: signed } = await supabase.storage.from("wishlist").createSignedUrls(paths, 3600);
  const urls = new Map(
    (signed ?? []).map((s) => [s.path ?? "", s.signedUrl as string | null]),
  );
  return items.map((i) => ({
    ...i,
    image_url: i.image_path ? (urls.get(i.image_path) ?? null) : null,
  }));
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
