/** 表示フォーマッタ。円・パーセント・bb/100・日付（○月○日(曜)）。 */

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** ○月○日(曜) 形式（HANDOFF §5）。 */
export function formatDateJP(epochMs: number): string {
  const d = new Date(epochMs);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const w = WEEKDAYS[d.getDay()];
  return `${m}月${day}日(${w})`;
}

/** 円表記（符号付きにするなら signed=true）。 */
export function yen(value: number, signed = false): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  const sign = signed && rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded).toLocaleString('ja-JP');
  return `${sign}¥${abs}`;
}

/** bb/100 表記（小数1桁・符号付き）。 */
export function bb100Text(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}`;
}

/** パーセント表記（小数1桁）。 */
export function pct(value: number, signed = false): string {
  if (!Number.isFinite(value)) return '—';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

/** 上位◯% 表記（平均着順用・小数1桁）。 */
export function topPct(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `上位${value.toFixed(1)}%`;
}

/** 期間ラベル "6/1〜7/1" 形式。空なら "—"。 */
export function rangeLabel(dates: readonly number[]): string {
  if (dates.length === 0) return '—';
  const min = Math.min(...dates);
  const max = Math.max(...dates);
  const f = (ms: number) => {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  return min === max ? f(min) : `${f(min)}〜${f(max)}`;
}
