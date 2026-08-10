/** DB の型。docs/03-database.md と1対1に対応させる。 */

export type UserRole = "owner" | "manager" | "staff" | "viewer";
export type BusinessMode = "normal" | "event";
export type SeatArea = "counter" | "table" | "private";

export type ReservationSource =
  | "web_form"
  | "instagram_dm"
  | "line"
  | "phone"
  | "owner_direct"
  | "walk_in"
  | "other";

export type ReservationStatus =
  | "tentative"
  | "confirmed"
  | "seated"
  | "completed"
  | "no_show"
  | "cancelled";

export type PermissionCode =
  | "reservation.read"
  | "reservation.write"
  | "reservation.override"
  | "businessday.write"
  | "rule.write"
  | "stats.read"
  | "settings.write"
  | "account.write"
  | "audit.read"
  | "shift.write"
  | "shiftrequest.write"
  | "sales.write";

export type Profile = {
  id: string;
  login_id: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  must_change_password: boolean;
  is_owner_contact: boolean;
  sort_order: number;
  created_at: string;
};

export type BusinessDay = {
  biz_date: string; // YYYY-MM-DD
  mode: BusinessMode;
  is_busy: boolean;
  is_closed: boolean;
  event_name: string | null;
  event_capacity: number | null;
  open_min: number; // その日の 0:00 からの経過分。18:00 = 1080
  close_min: number; // 25:00 = 1500
  /** イベント営業のチラシ（画像またはPDF）の公開URL。イベント日は必須 */
  flyer_url: string | null;
  note: string | null;
  updated_by: string | null;
  updated_at: string;
};

export type DailySummary = Pick<
  BusinessDay,
  | "biz_date"
  | "mode"
  | "is_busy"
  | "is_closed"
  | "event_name"
  | "event_capacity"
  | "open_min"
  | "close_min"
> & {
  reservation_count: number;
  guest_count: number;
  tentative_count: number;
  cancelled_count: number;
  no_show_count: number;
  remaining_capacity: number | null;
};

export type Reservation = {
  id: string;
  reference: string;
  biz_date: string;
  starts_at: string;
  ends_at: string;
  party_size: number;
  customer_name: string;
  customer_kana: string | null;
  phone: string | null;
  source: ReservationSource;
  source_profile_id: string | null;
  source_detail: string | null;
  external_ref: string | null;
  status: ReservationStatus;
  is_exclusive: boolean;
  course_id: string | null;
  drink_plan: boolean;
  budget_yen: number | null;
  needs_invoice: boolean;
  invoice_name: string | null;
  allergy: string | null;
  memo: string | null;
  seat_note: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SeatUnit = {
  id: string;
  code: string;
  name: string;
  area: SeatArea;
  capacity: number;
  min_party: number;
  is_shared: boolean;
  is_joinable: boolean;
  sort_order: number;
  is_active: boolean;
  note: string | null;
};

export type Course = {
  id: string;
  name: string;
  price_yen: number | null;
  includes_drink: boolean;
  min_party: number;
  note: string | null;
  sort_order: number;
  is_active: boolean;
};

/**
 * その日の席の埋まり具合。
 * Phase 1 は時間帯の重なりまでは見ない——1晩1組の前提で「その日に予約がある席は埋まり」。
 * カウンターだけは相席なので、人数の合計で見る。
 */
export type SeatUsage = {
  /** 埋まっている専有席の名前（T1・和室 など） */
  taken: string[];
  /** カウンターに入っている人数の合計 */
  counter_used: number;
};

export type Shift = {
  biz_date: string;
  profile_id: string;
  created_by: string | null;
  created_at: string;
};

export type AuditLog = {
  id: number;
  actor: string | null;
  action: string;
  target_table: string;
  target_id: string | null;
  before: unknown;
  after: unknown;
  at: string;
};
