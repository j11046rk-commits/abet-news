import type { Reservation, Session } from "@/lib/types";

/** 終了時刻が入っていない卓の、見た目上の長さ（時間）。 */
export const OPEN_TABLE_HOURS = 1;

/** その卓が占める時間。終了が空なら仮の長さで見る。 */
export function tableSpan(s: Session): [number, number] {
  const st = new Date(s.started_at).getTime();
  return [st, s.ended_at ? new Date(s.ended_at).getTime() : st + OPEN_TABLE_HOURS * 3600_000];
}

/**
 * 予約と卓を「同じ開催」に束ねる。
 *
 * 施設は1部屋しかないので、時間が重なっている予約と卓は同じ夜のこと。
 * 別々に描くと、1回の開催が2つ入っているように見える。
 * 束ねた卓は予約の側に金額として出し、単独の印は描かない。
 */
export function pairTables(reservations: Reservation[], sessions: Session[]) {
  const byReservation = new Map<string, Session[]>();
  const paired = new Set<string>();

  for (const s of sessions) {
    const [ss, se] = tableSpan(s);
    const r = reservations.find(
      (x) => new Date(x.starts_at).getTime() < se && new Date(x.ends_at).getTime() > ss,
    );
    if (!r) continue;
    byReservation.set(r.id, [...(byReservation.get(r.id) ?? []), s]);
    paired.add(s.id);
  }

  return {
    byReservation,
    /** どの予約にも紐づかない卓。単独の印として描く。 */
    loose: sessions.filter((s) => !paired.has(s.id)),
  };
}

/**
 * その日に始まった卓のレーキ合計。
 *
 * 日をまたぐ開催は表示が2日に分かれるので、始まった日のぶんだけ数える。
 * 両日に出すと同じレーキを2回数えることになる。
 */
export function rakeStartedOn(
  list: Session[] | undefined,
  dayStart: number,
  dayEnd: number,
): number {
  if (!list?.length) return 0;
  return list.reduce((n, s) => {
    const t = new Date(s.started_at).getTime();
    return t >= dayStart && t < dayEnd ? n + s.rake_yen : n;
  }, 0);
}
