export type UserRole = "owner" | "member";
export type GameType = "cash" | "tournament" | "other";
export type ReservationPurpose = "poker" | "meeting" | "private" | "lodging" | "other";
export type LedgerDirection = "income" | "expense";

export type Profile = {
  id: string;
  login_id: string;
  display_name: string;
  role: UserRole;
  investment_yen: number;
  must_change_password: boolean;
  is_active: boolean;
  joined_on: string;
};

export type Player = {
  id: string;
  name: string;
  profile_id: string | null;
  created_at: string;
};

export type Session = {
  id: string;
  started_at: string;
  ended_at: string | null;
  game_type: GameType;
  rake_yen: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type Reservation = {
  id: string;
  title: string | null;
  purposes: ReservationPurpose[];
  is_exclusive: boolean;
  starts_at: string;
  ends_at: string;
  headcount: number;
  memo: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type LedgerEntry = {
  id: string;
  entry_date: string;
  direction: LedgerDirection;
  category: string;
  amount_yen: number;
  memo: string | null;
  session_id: string | null;
  created_by: string | null;
  created_at: string;
};

export type FixedCost = {
  id: string;
  name: string;
  amount_yen: number;
  billing_day: number;
  is_active: boolean;
};

export type Settings = {
  id: boolean;
  facility_name: string;
  monthly_target_yen: number;
  owner_count: number;
  rake_rule: string | null;
};

export type MonthlySummary = {
  ym: string;
  income_yen: number;
  expense_yen: number;
  net_yen: number;
  balance_yen: number;
};

export type SessionStats = {
  session_count: number;
  avg_rake_yen: number;
  avg_rake_90d_yen: number;
  sessions_last_30d: number;
  total_rake_yen: number;
  last_session_at: string | null;
};

export type ExclusiveHours = {
  profile_id: string;
  ym: string;
  exclusive_hours: number;
  shared_hours: number;
};

/* ── 用途 ────────────────────────────────────────────────────────────── */

export const PURPOSES: { value: ReservationPurpose; ja: string; en: string; color: string }[] = [
  { value: "poker", ja: "ポーカー", en: "POKER", color: "var(--brass)" },
  { value: "meeting", ja: "ミーティング", en: "MEETING", color: "var(--smoke)" },
  { value: "private", ja: "プライベート", en: "PRIVATE", color: "var(--claret)" },
  { value: "lodging", ja: "宿泊", en: "LODGING", color: "var(--pine)" },
  { value: "other", ja: "その他", en: "OTHER", color: "var(--ash)" },
];

export const purposeMeta = (p: ReservationPurpose) =>
  PURPOSES.find((x) => x.value === p) ?? PURPOSES[4];

export const GAME_TYPES: { value: GameType; ja: string }[] = [
  { value: "cash", ja: "キャッシュ" },
  { value: "tournament", ja: "トーナメント" },
  { value: "other", ja: "その他" },
];

export const gameTypeJa = (g: GameType) =>
  GAME_TYPES.find((x) => x.value === g)?.ja ?? "その他";

/* ── 台帳カテゴリ ────────────────────────────────────────────────────── */

export const INCOME_CATEGORIES: { value: string; ja: string }[] = [
  { value: "rake", ja: "レーキ" },
  { value: "guest_fee", ja: "ゲストフィー" },
  { value: "drink", ja: "ドリンク" },
  { value: "investment", ja: "出資・追加拠出" },
];

export const EXPENSE_CATEGORIES: { value: string; ja: string }[] = [
  { value: "rent", ja: "家賃" },
  { value: "utilities", ja: "光熱費" },
  { value: "supplies", ja: "備品" },
  { value: "other", ja: "その他" },
];

export const categoryJa = (direction: LedgerDirection, value: string) => {
  const list = direction === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  return list.find((c) => c.value === value)?.ja ?? value;
};
