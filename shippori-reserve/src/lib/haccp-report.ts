import "server-only";
import { monthRange, shiftDate, todayBizDate, weekdayOf, WEEKDAY_JA } from "@/lib/time";
import {
  DAY_STATE_LABEL,
  GROUP_SHORT,
  INCIDENT_CATEGORY_LABEL,
  RESULT_LABEL,
  TIMING_LABEL,
  planForDate,
  requiredChecks,
  type RequiredCheck,
} from "@/lib/haccp";
import {
  getBatches,
  getChecks,
  getClosedDays,
  getDaysHaccp,
  getIncidents,
  getPlans,
  getReviews,
} from "@/lib/haccp-data";
import { getProfileNames } from "@/lib/queries";
import { mdhm } from "@/lib/haccp-time";

/*
 * 帳票（印刷・PDF・CSV で同じ中身）。
 * ★未記録は「未記録」、休業は「休業」、計画に無い日は「—」。良好で埋めることはしない。
 */

export type ReportType = "general" | "temps" | "critical" | "incidents" | "reviews";
export const REPORT_TITLE: Record<ReportType | "plan", string> = {
  plan: "衛生管理計画",
  general: "一般衛生管理の実施記録",
  temps: "冷蔵庫・冷凍庫の温度記録（設備別）",
  critical: "重要管理の実施記録",
  incidents: "異常と改善対応の記録",
  reviews: "記録の確認・振り返り",
};

export type Report = {
  title: string;
  store: string;
  period: string;
  columns: string[];
  rows: (string | number | null)[][];
  notes: string[];
};

const cellResult = (r: string | undefined) => (r ? RESULT_LABEL[r as "ok"] : "");

export async function buildReport(type: ReportType, ym: string, opts: { blank?: boolean } = {}): Promise<Report> {
  const { from, to } = monthRange(ym);
  const today = todayBizDate();
  const [plans, names, closed] = await Promise.all([getPlans(), getProfileNames(), getClosedDays(from, to)]);
  const plan = planForDate(plans, to) ?? planForDate(plans, from) ?? plans.find((p) => p.status !== "draft") ?? null;
  const store = plan?.store_name ?? "おばんざい家庭料理 しっぽり亭";
  const period = `${from} 〜 ${to}`;
  const nm = (id: string | null | undefined) => (id ? names.get(id) ?? "?" : "");
  // 温度計（SwitchBot）が自動で書いた記録は記録者が空（0068）。帳票では「温度計（自動）」と出す
  const who = (r: { recorded_by: string | null; source?: string | null }) => (r.source === "auto" ? "温度計（自動）" : nm(r.recorded_by));
  const dates: string[] = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) dates.push(d);
  const base = { title: REPORT_TITLE[type], store, period, notes: [] as string[] };

  if (type === "general" || type === "temps") {
    // 月の中で計画の版が変わっても、その日の版の項目で並べる
    const colMap = new Map<string, RequiredCheck>();
    for (const d of dates) {
      const p = planForDate(plans, d);
      if (!p) continue;
      for (const r of requiredChecks(p.content, type === "temps")) {
        if (type === "general" ? r.kind !== "eq" : r.kind === "eq") colMap.set(r.key, r);
      }
    }
    const cols = [...colMap.values()];
    const checks = opts.blank ? [] : await getChecks(from, to);
    const by = new Map(checks.map((c) => [`${c.biz_date}|${c.check_key}`, c]));
    const days = opts.blank ? null : await getDaysHaccp(from, to, today, { plans, closed, checks });

    if (type === "general") {
      const columns = ["日付", "曜日", "状態", ...cols.map((c) => `${c.label}（${TIMING_LABEL[c.timing]}）`), "実施者", "特記事項（問題・対応）", "追記・修正"];
      const rows = dates.map((d) => {
        const p = planForDate(plans, d);
        const req = new Set(p ? requiredChecks(p.content).map((r) => r.key) : []);
        const isClosed = closed.has(d);
        const dayRows = cols.map((c) => by.get(`${d}|${c.key}`)).filter(Boolean);
        const cells = cols.map((c) => {
          if (opts.blank) return isClosed ? "休" : "";
          const row = by.get(`${d}|${c.key}`);
          if (row) return cellResult(row.result) + (row.first_result !== row.result ? `（当初:${RESULT_LABEL[row.first_result]}）` : "");
          if (!req.has(c.key)) return "—";
          if (isClosed) return "休業";
          return d < today ? "未記録" : "";
        });
        const notes = dayRows
          .filter((r) => r!.note || r!.action)
          .map((r) => `${colMap.get(r!.check_key)?.label ?? ""}：${[r!.note, r!.action].filter(Boolean).join("／")}`)
          .join("；");
        const late = dayRows.filter((r) => r!.entered_late || r!.revision > 1).length;
        return [
          d,
          WEEKDAY_JA[weekdayOf(d)],
          opts.blank ? (isClosed ? "休業" : "") : DAY_STATE_LABEL[days!.get(d)!.state],
          ...cells,
          opts.blank ? "" : [...new Set(dayRows.map((r) => who(r!)))].join("・"),
          opts.blank ? "" : notes,
          opts.blank ? "" : late ? `${late}件` : "",
        ];
      });
      base.notes.push("良好＝問題なし／問題あり／該当なし（納品なし等）／未記録＝記録が無い／休業＝営業日の設定で休業／—＝その日の計画に無い項目");
      if (opts.blank) base.notes.push("手書き用の用紙です。確認者欄に週ごとの確認者が記入してください。");
      return { ...base, columns, rows };
    }

    const columns = ["日付", "曜日", "設備", "時間帯", "基準", "温度(℃)", "判定", "測定時刻", "実施者", "備考", "追記・修正"];
    const rows: (string | number | null)[][] = [];
    for (const d of dates) {
      const p = planForDate(plans, d);
      const req = new Set(p ? requiredChecks(p.content, true).map((r) => r.key) : []);
      for (const c of cols) {
        if (!req.has(c.key) && !by.has(`${d}|${c.key}`)) continue;
        const eq = p?.content.equipment.find((e) => e.id === c.ref);
        const row = by.get(`${d}|${c.key}`);
        const crit = row?.criteria ?? (eq ? { maxC: eq.maxC, minC: eq.minC } : null);
        const critText = crit ? [crit.maxC != null ? `${crit.maxC}℃以下` : "", crit.minC != null ? `${crit.minC}℃以上` : ""].filter(Boolean).join("・") : "";
        rows.push([
          d,
          WEEKDAY_JA[weekdayOf(d)],
          c.label,
          TIMING_LABEL[c.timing],
          critText,
          row?.temp_c != null ? Number(row.temp_c) : null,
          opts.blank ? "" : row ? cellResult(row.result) : closed.has(d) ? "休業" : d < today ? "未記録" : "",
          row ? mdhm(row.measured_at) : "",
          row ? who(row) : "",
          row ? [row.note, row.action].filter(Boolean).join("／") : "",
          row ? [row.entered_late ? `追記(入力${mdhm(row.recorded_at)})` : "", row.revision > 1 ? `修正${row.revision - 1}回` : ""].filter(Boolean).join(" ") : "",
        ]);
      }
    }
    return { ...base, columns, rows };
  }

  if (type === "critical") {
    const [checks, batches] = await Promise.all([getChecks(from, to), getBatches(from, to)]);
    const columns = ["日付", "区分", "品名・グループ", "調理日時", "加熱", "冷却開始", "冷却終了", "冷却後の温度", "冷蔵", "高温保管", "再加熱", "保存先", "使用期限", "判定", "実施者", "備考・追記"];
    const rows: (string | number | null)[][] = [];
    for (const d of dates) {
      const p = planForDate(plans, d);
      for (const r of p ? requiredChecks(p.content).filter((x) => x.kind === "cc") : []) {
        const row = checks.find((c) => c.biz_date === d && c.check_key === r.key);
        rows.push([
          d, "日々の確認", `${GROUP_SHORT[r.ref as "g1"]}グループ（${TIMING_LABEL[r.timing]}）`, "", "", "", "", "", "", "", "", "", "",
          row ? cellResult(row.result) : closed.has(d) ? "休業" : d < today ? "未記録" : "",
          row ? nm(row.recorded_by) : "",
          row ? [row.note, row.action, row.entered_late ? "追記" : ""].filter(Boolean).join("／") : "",
        ]);
      }
      for (const b of batches.filter((x) => x.biz_date === d)) {
        const v = b.vals ?? {};
        const heat = (h?: { tempC?: number | null; holdSec?: number | null; ok?: boolean | null }) =>
          !h ? "" : h.ok != null ? (h.ok ? "確認OK" : "不足") : `${h.tempC ?? ""}℃ ${h.holdSec ?? ""}秒`;
        rows.push([
          d, "仕込み・調理", `${b.item_name}（${GROUP_SHORT[b.cc_group]}）`, mdhm(b.cooked_at), heat(v.heat),
          mdhm(v.cool?.startAt), mdhm(v.cool?.endAt), v.cool?.endTempC ?? null, v.chill?.tempC ?? null,
          v.hotHold?.tempC ?? null, heat(v.reheat), b.storage_place ?? "", mdhm(b.use_by),
          b.judgement === "ok" ? "基準どおり" : b.judgement === "ng" ? "基準外" : "途中（未完了）",
          nm(b.performer_id),
          [b.note, b.first_ng_at && b.judgement !== "ng" ? "一度基準外" : "", b.entered_late ? "追記" : "", b.revision > 1 ? `更新${b.revision - 1}回` : ""].filter(Boolean).join("／"),
        ]);
      }
    }
    return { ...base, columns, rows };
  }

  if (type === "incidents") {
    const list = await getIncidents({ from, to });
    const columns = ["発生日時", "営業日", "種類", "対象", "問題の内容", "実施した対応", "処置", "再確認時刻", "再確認結果", "担当者", "対応期限", "改善・再発防止", "状態", "確認者", "確認日時", "記録者"];
    const rows = [...list].reverse().map((i) => [
      mdhm(i.occurred_at), i.biz_date, INCIDENT_CATEGORY_LABEL[i.category] ?? i.category, i.target, i.problem,
      i.action ?? "", i.dispositions.join("・"), mdhm(i.recheck_at),
      i.recheck_result === "ok" ? "問題なし" : i.recheck_result === "ng" ? "問題あり" : "", nm(i.handler_id), i.due_on ?? "",
      i.prevention ?? "", i.status === "open" ? "対応中" : "対応済み", nm(i.confirmer_id), mdhm(i.confirmed_at), nm(i.created_by),
    ]);
    return { ...base, columns, rows };
  }

  // reviews
  const list = await getReviews(shiftDate(from, -6), to);
  const columns = ["種類", "期間", "確認者", "確認日時", "確認時の集計", "コメント", "繰り返している問題", "改善事項（担当・期限・状況）", "計画の見直し"];
  const rows = list.map((r) => [
    r.kind === "week" ? "週の確認" : "月の振り返り",
    `${r.period_start}〜${r.period_end}`,
    nm(r.reviewer_id),
    mdhm(r.reviewed_at) + (r.updated_at ? `（更新 ${mdhm(r.updated_at)}）` : ""),
    `完了${r.summary.complete ?? 0}日・一部${r.summary.partial ?? 0}日・未記録${r.summary.none ?? 0}日・問題${r.summary.ng ?? 0}件・対応中${r.summary.open ?? 0}件`,
    r.comment ?? "",
    r.repeat_issues ?? "",
    r.improvements.map((x) => `${x.task}（${x.owner || "担当未定"}・${x.due || "期限未定"}・${x.done ? "済" : "未"}）`).join("／"),
    r.kind === "month" ? (r.plan_review_needed ? "必要" : "不要") : "",
  ]);
  return { ...base, columns, rows };
}
