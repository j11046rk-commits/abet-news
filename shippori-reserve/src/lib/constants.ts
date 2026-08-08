import type {
  PermissionCode,
  ReservationSource,
  ReservationStatus,
  UserRole,
} from "@/lib/types";

/**
 * 流入元。**この6つ（+その他）を1画面に集約する**のがこのシステムの目的。
 * 既定値を持たせない。選ばないと保存できない（docs/02-screens.md S4）。
 */
export const SOURCES: {
  value: ReservationSource;
  label: string;
  short: string;
}[] = [
  { value: "phone", label: "電話", short: "電話" },
  // enum の 'other' を「スタッフ連絡」（スタッフへの直接連絡）として使う（店主指定 2026-08-08）
  { value: "other", label: "スタッフ連絡", short: "スタッフ" },
  { value: "line", label: "公式LINE", short: "LINE" },
  { value: "instagram_dm", label: "DM", short: "DM" },
  { value: "web_form", label: "ホームページ", short: "HP" },
  { value: "owner_direct", label: "オーナー直接", short: "直通" },
  { value: "walk_in", label: "当日飛び込み", short: "飛込" },
];

/**
 * 予約登録フォームに並べる流入元。この4つ・この順（店主指定 2026-08-08）。
 * ホームページ（web_form）は Phase 3 の公開フォームから自動で入る値なので、手入力には出さない。
 */
export const SELECTABLE_SOURCES = (["phone", "other", "line", "instagram_dm"] as const).map(
  (v) => SOURCES.find((s) => s.value === v)!,
);

export const SOURCE_LABEL: Record<ReservationSource, string> = Object.fromEntries(
  SOURCES.map((s) => [s.value, s.label]),
) as Record<ReservationSource, string>;

export const SOURCE_SHORT: Record<ReservationSource, string> = Object.fromEntries(
  SOURCES.map((s) => [s.value, s.short]),
) as Record<ReservationSource, string>;

export const STATUSES: {
  value: ReservationStatus;
  label: string;
  /** 席・定員を押さえている状態か（キャンセルとno-showは数えない） */
  holds: boolean;
}[] = [
  { value: "tentative", label: "仮予約", holds: true },
  { value: "confirmed", label: "確定", holds: true },
  { value: "seated", label: "来店中", holds: true },
  { value: "completed", label: "会計済", holds: true },
  { value: "cancelled", label: "キャンセル", holds: false },
  { value: "no_show", label: "無断キャンセル", holds: false },
];

export const STATUS_LABEL: Record<ReservationStatus, string> = Object.fromEntries(
  STATUSES.map((s) => [s.value, s.label]),
) as Record<ReservationStatus, string>;

/** 予約件数・人数に数える状態 */
export const ACTIVE_STATUSES: ReservationStatus[] = [
  "tentative",
  "confirmed",
  "seated",
  "completed",
];

export const ROLE_LABEL: Record<UserRole, string> = {
  owner: "オーナー",
  manager: "店長",
  staff: "スタッフ",
  viewer: "閲覧のみ",
};

/**
 * ロールごとの初期権限。DB の role_permissions と同じ内容を持つ。
 *
 * DB が正で、ここは画面の出し分け（ボタンを描くかどうか）にだけ使う。
 * 権限を細分化して role_permissions に行を足した場合、ここを直さなくても
 * DB は正しく振る舞う（ボタンの表示だけが追いつかない）。
 */
const ALL_PERMISSIONS: PermissionCode[] = [
  "reservation.read",
  "reservation.write",
  "reservation.override",
  "businessday.write",
  "rule.write",
  "stats.read",
  "settings.write",
  "account.write",
  "audit.read",
  "shift.write",
  "sales.write",
];

export const ROLE_PERMISSIONS: Record<UserRole, PermissionCode[]> = {
  // オーナー・店長＝確定シフトを組む側（shift.write）。
  // 一般スタッフ＝希望を出す側（shiftrequest.write）。店長は提出しない（店主指定）。
  owner: ALL_PERMISSIONS,
  manager: ALL_PERMISSIONS.filter((p) => p !== "account.write"),
  staff: [
    "reservation.read",
    "reservation.write",
    "reservation.override",
    "stats.read",
    "shiftrequest.write",
  ],
  viewer: ["reservation.read"],
};

export const can = (role: UserRole, perm: PermissionCode): boolean =>
  ROLE_PERMISSIONS[role].includes(perm);

/**
 * 営業時間の既定値（分。0:00 からの経過分）。
 * 通常営業＝平日24:00・金土25:00閉店。イベント営業＝18:00〜24:00（店主指定）。
 */
export const DEFAULT_OPEN_MIN = 1080; // 18:00
export const DEFAULT_CLOSE_MIN = 1440; // 24:00
export const FRI_SAT_CLOSE_MIN = 1500; // 25:00（通常営業の金土）
export const EVENT_OPEN_MIN = 1080; // 18:00
export const EVENT_CLOSE_MIN = 1440; // 24:00
export const DEFAULT_STAY_MIN = 120;
export const DEFAULT_EVENT_CAPACITY = 36;
export const TOTAL_SEATS = 36;
/** 火曜定休（0=日 … 6=土） */
export const CLOSED_WEEKDAYS = [2];
