export type UserRole = "owner" | "member";
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

export type Session = {
  id: string;
  started_at: string;
  ended_at: string | null;
  rake_yen: number;
  headcount: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

/** 施設への出入り。checked_out_at が null の行が「いま滞在中」。 */
export type CheckIn = {
  id: string;
  profile_id: string;
  checked_in_at: string;
  checked_out_at: string | null;
  /** 朝10時の自動締めで閉じた行。本人が押したものと区別する。 */
  auto_closed: boolean;
  /** 滞在の用途。予約と同じ enum。 */
  purposes: ReservationPurpose[];
  /** 本人を含む人数。 */
  headcount: number;
  memo: string | null;
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
  /** 固定費マスタから自動起票された行。台帳側からは直せない。 */
  fixed_cost_id: string | null;
  /** 立替の精算から自動起票された行。立替側のチェックを外すと消える。 */
  advance_id: string | null;
  created_by: string | null;
  created_at: string;
};

/** 通帳の1行。entries に残高を載せたもの。 */
export type PassbookRow = LedgerEntry & { balance_yen: number };

export type FixedCost = {
  id: string;
  name: string;
  amount_yen: number;
  billing_day: number;
  is_active: boolean;
  category: string;
};

/** 個人が立て替えた費用。settled_at が入れば精算済み。 */
export type Advance = {
  id: string;
  profile_id: string;
  title: string;
  amount_yen: number;
  due_on: string | null;
  settled_at: string | null;
  created_by: string | null;
  created_at: string;
};

/** ほしい物リストの1件。image_url は署名URL（サーバで都度発行する）。 */
export type WishlistItem = {
  id: string;
  title: string;
  amount_yen: number | null;
  note: string | null;
  image_path: string | null;
  bought_at: string | null;
  created_by: string;
  created_at: string;
};

export type WishlistItemView = WishlistItem & { image_url: string | null };

export type Settings = {
  id: boolean;
  facility_name: string;
  monthly_target_yen: number;
  owner_count: number;
  rake_rule: string | null;
  /** 水道代・電気代の未記帳を警告しはじめる年月（YYYY-MM）。 */
  utilities_alert_from: string;
};

export type MonthlySummary = {
  ym: string;
  income_yen: number;
  /** 出資・追加拠出を除いた収入。月次目標はこれで測る。 */
  operating_income_yen: number;
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

/**
 * color  = 面（ブロック・スウォッチ）に使う色
 * ink    = その色で塗りつぶしたときに載せる文字色
 * text   = ink 背景の上に極小の大文字ラベルとして置くときの色。
 *          claret / pine / ash はそのままでは暗すぎて読めないため、同じ色相を明るくした値を使う。
 */
export const PURPOSES: {
  value: ReservationPurpose;
  ja: string;
  en: string;
  color: string;
  onFill: string;
  text: string;
}[] = [
  { value: "poker",    ja: "ポーカー",       en: "POKER",   color: "var(--brass)",  onFill: "var(--ink)",   text: "var(--brass)" },
  { value: "meeting",  ja: "ビジネス",       en: "BUSINESS", color: "var(--smoke)",  onFill: "var(--ink)",   text: "var(--smoke)" },
  { value: "private",  ja: "プライベート",   en: "PRIVATE", color: "var(--claret)", onFill: "var(--paper)", text: "#A2606A" },
  { value: "lodging",  ja: "宿泊",           en: "LODGING", color: "var(--pine)",   onFill: "var(--paper)", text: "#7E948A" },
  { value: "other",    ja: "その他",         en: "OTHER",   color: "var(--ash)",    onFill: "var(--paper)", text: "#8A8177" },
];

export const purposeMeta = (p: ReservationPurpose) =>
  PURPOSES.find((x) => x.value === p) ?? PURPOSES[4];

/* ── 台帳カテゴリ ────────────────────────────────────────────────────── */

export const INCOME_CATEGORIES: { value: string; ja: string }[] = [
  { value: "rake", ja: "レーキ" },
  { value: "guest_fee", ja: "ゲストフィー" },
  { value: "drink", ja: "ドリンク" },
  { value: "investment", ja: "出資・追加拠出" },
];

export const EXPENSE_CATEGORIES: { value: string; ja: string }[] = [
  { value: "rent", ja: "家賃" },
  { value: "common_fee", ja: "共益費" },
  { value: "water", ja: "水道代" },
  { value: "electricity", ja: "電気代" },
  { value: "supplies", ja: "備品" },
  { value: "advance_settle", ja: "立替の精算" },
  { value: "other", ja: "その他" },
  // 旧「光熱費」。過去の行を読むために残してある。新規では選ばせない。
  { value: "utilities", ja: "光熱費" },
];

/** 毎月かならず出るが、金額が変わるので自動起票できない費目。未記帳を警告する。 */
export const METERED_CATEGORIES: { value: string; ja: string }[] = [
  { value: "water", ja: "水道代" },
  { value: "electricity", ja: "電気代" },
];

/** 新規記帳で選ばせるカテゴリ（廃止済みのものを除く）。 */
export const EXPENSE_CATEGORIES_ACTIVE = EXPENSE_CATEGORIES.filter(
  (c) => c.value !== "utilities",
);

export const categoryJa = (direction: LedgerDirection, value: string) => {
  const list = direction === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  return list.find((c) => c.value === value)?.ja ?? value;
};
