/*
 * タイムカードの押し忘れを見つける（店主指示 2026-11-09）。
 *
 * 業務の流れ：店長LINEに知らせる → 店長（ユウトさん）が実際の時刻をグループに書く
 *             → 事務（アリサさん）が freee で直す → 翌朝の取り込みで直ったことが分かり、知らせは消える
 *
 * 見つけるもの
 *   no_clock_out … 出勤だけで退勤が無い
 *   no_break_end … 休憩に入ったまま戻りが無い
 *   no_clock_in  … アプリの確定シフトでは出勤なのに、その日の打刻が1つも無い（出勤の押し忘れ）
 *
 * 時給・金額は扱わない（名前・日付・何が抜けているか・出勤の時刻だけ）。
 * このファイルは値の import を持たない（node --test で直に回せるようにするため）。
 */

export type IssueKind = "no_clock_out" | "no_break_end" | "no_clock_in";

export const ISSUE_LABEL: Record<IssueKind, string> = {
  no_clock_out: "退勤なし",
  no_break_end: "休憩の戻りなし",
  no_clock_in: "打刻なし（シフトでは出勤）",
};

export type Issue = { date: string; employeeId: number; name: string; kind: IssueKind; detail: string | null };

type Span = { clock_in_at?: string | null; clock_out_at?: string | null };
export type PunchRecord = {
  date: string;
  clock_in_at?: string | null;
  clock_out_at?: string | null;
  work_record_segments?: Span[] | null;
  break_records?: Span[] | null;
  is_absence?: boolean | null;
};

const hm = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(11, 16);

/** 名前を比べるための形（全角半角・空白の揺れを吸収） */
export const nameKey = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");

/**
 * from〜to（両端を含む・ふつうは「昨日まで」）の押し忘れ。
 * staff：freee の従業員（id・名前）と、その人の日ごとの打刻。
 * scheduled：日付 → その日に確定シフトで出勤の人の名前（アプリの表示名）
 */
export function detectIssues(
  staff: { id: number; name: string; records: PunchRecord[] }[],
  scheduled: Map<string, string[]>,
  from: string,
  to: string,
): Issue[] {
  const out: Issue[] = [];
  const punchedByDate = new Map<string, Set<string>>();
  for (const s of staff) {
    const seen = new Set<string>();
    for (const r of s.records) {
      if (r.date < from || r.date > to || seen.has(r.date) || r.is_absence) continue;
      seen.add(r.date);
      const segs = r.work_record_segments && r.work_record_segments.length > 0 ? r.work_record_segments : [{ clock_in_at: r.clock_in_at, clock_out_at: r.clock_out_at }];
      const any = segs.some((g) => g.clock_in_at || g.clock_out_at);
      if (any) {
        if (!punchedByDate.has(r.date)) punchedByDate.set(r.date, new Set());
        punchedByDate.get(r.date)!.add(nameKey(s.name));
      }
      const open = segs.find((g) => g.clock_in_at && !g.clock_out_at);
      if (open) out.push({ date: r.date, employeeId: s.id, name: s.name, kind: "no_clock_out", detail: `出勤 ${hm(open.clock_in_at!)}` });
      const brk = (r.break_records ?? []).find((b) => b.clock_in_at && !b.clock_out_at);
      if (brk) out.push({ date: r.date, employeeId: s.id, name: s.name, kind: "no_break_end", detail: `休憩 ${hm(brk.clock_in_at!)}〜` });
    }
  }
  // シフトでは出勤なのに打刻が無い（freee の名前とアプリの名前が合う人だけ）
  const byKey = new Map(staff.map((s) => [nameKey(s.name), s]));
  for (const [date, names] of scheduled) {
    if (date < from || date > to) continue;
    for (const n of names) {
      const s = byKey.get(nameKey(n));
      if (!s) continue;
      if (punchedByDate.get(date)?.has(nameKey(s.name))) continue;
      out.push({ date, employeeId: s.id, name: s.name, kind: "no_clock_in", detail: null });
    }
  }
  return out.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name, "ja") : a.date < b.date ? -1 : 1));
}

/** 店長LINEへの知らせ（新しく見つかった分だけ・まとめて1通） */
export function issueMessage(issues: Issue[]): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const lines = issues.map((i) => `・${md(i.date)} ${i.name}さん：${ISSUE_LABEL[i.kind]}${i.detail ? `（${i.detail}）` : ""}`);
  return [
    "🕐 タイムカードの押し忘れがあります",
    ...lines,
    "",
    "ユウトさん：実際の時刻をこのグループに書いてください。",
    "アリサさん：freee人事労務で直してください。",
    "直ると、翌朝の取り込みで人件費も自動で直ります。",
  ].join("\n");
}
