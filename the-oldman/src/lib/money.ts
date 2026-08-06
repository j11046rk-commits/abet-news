/** 金額はすべて円の整数。小数は使わない（SPEC §4）。 */

export const yen = (n: number): string =>
  `¥${Math.round(n).toLocaleString("ja-JP")}`;

/** 符号付き。台帳の支出行など */
export const yenSigned = (n: number): string =>
  `${n < 0 ? "−" : ""}¥${Math.abs(Math.round(n)).toLocaleString("ja-JP")}`;

export const parseYen = (s: string): number => {
  const n = Number(String(s).replace(/[^\d-]/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/** 0..1 に丸めた達成率 */
export const ratio = (value: number, target: number): number => {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, value / target));
};

/** 端数は切り上げ。「あと何回」「1人あたり」は不足させないため */
export const ceilDiv = (a: number, b: number): number =>
  b <= 0 ? 0 : Math.ceil(a / b);
