/*
 * ネット予約で選べるコースの条件（店主指定 2026-11-03）。
 *
 *   ・前日までのご予約に限る（来店日が今日より後）
 *   ・コースごとの人数（min_party）以上・ネット予約の上限（8名）以下
 *   ・ネットで選べる期間（net_until）まで
 *
 * 画面（選べるかの表示）とサーバー（最後の確認）で同じ関数を使う。
 * このファイルは値のimportを持たない（node --test で直に回せるようにするため）。
 */

export type NetCourse = {
  id: string;
  name: string;
  price_yen: number | null;
  min_party: number;
  note: string | null;
  net_until: string;
};

/** 100分飲み放題を付けたときの追加料金（税込・おひとり） */
export const NET_COURSE_DRINK_YEN = 2000;

/** 選べない理由。選べるなら null */
export function courseBlockReason(
  c: Pick<NetCourse, "min_party" | "net_until">,
  date: string | null,
  party: number,
  today: string,
): string | null {
  if (!date) return "日付を選ぶと選べます";
  if (date <= today) return "前日までのご予約で選べます";
  if (date > c.net_until) return "この日は対象外です";
  if (party < c.min_party) return `${c.min_party}名様から選べます`;
  return null;
}
