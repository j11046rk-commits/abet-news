/**
 * ブランドカラートークン（HANDOFF §1）。
 * 数字は "計器" 感を出すためゴールド、勝ち＝グリーン、負け＝チップレッド。
 */
export const colors = {
  feltDark: '#0A2E24', // フェルト緑（背景・濃）
  feltLight: '#0E3B2E', // フェルト緑（背景・淡／グラデ上）
  bone: '#F4EFE4', // ボーン（文字・カード面）
  gold: '#C9A24B', // ゴールド（主役数字・アクセント）
  green: '#7FB77E', // グリーン（勝ち・プラス）
  chipRed: '#C2603F', // チップレッド（負け・マイナス）
  muted: '#7C8C82', // ミュート（補助文字）
  ink: '#14231C', // インク（明色面の文字）
} as const;

/** 収支の符号で色を返す（0はボーン扱い）。 */
export function profitColor(value: number): string {
  if (!Number.isFinite(value) || value === 0) return colors.bone;
  return value > 0 ? colors.green : colors.chipRed;
}

export type ColorToken = keyof typeof colors;
