/* 衛生管理の日時の表示・入力（日本時間）。画面とサーバーの両方から使う */

/** ISO → 日本時間の「YYYY-MM-DDTHH:mm」（datetime-local の値） */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return d.toISOString().slice(0, 16);
}
/** datetime-local の値（日本時間）→ ISO */
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(`${v}:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
export const nowLocalInput = () => toLocalInput(new Date().toISOString());
export const hm = (iso: string | null | undefined) => (iso ? toLocalInput(iso).slice(11, 16) : "");
export const mdhm = (iso: string | null | undefined) =>
  iso ? `${Number(toLocalInput(iso).slice(5, 7))}/${Number(toLocalInput(iso).slice(8, 10))} ${hm(iso)}` : "";

