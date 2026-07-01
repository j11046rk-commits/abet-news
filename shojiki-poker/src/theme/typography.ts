import { Platform } from 'react-native';

/**
 * タイポグラフィ（HANDOFF §1）。
 * - 数字/データ: monospace（"計器" 感）
 * - 見出し/タグ: serif（要所）
 * - 本文/UI: システムsans（Hiragino / Noto Sans JP）
 */
export const fonts = {
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  sans: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }),
} as const;

export const type = {
  heroNumber: { fontFamily: fonts.mono, fontSize: 56, fontWeight: '700' as const },
  kpiNumber: { fontFamily: fonts.mono, fontSize: 22, fontWeight: '600' as const },
  dataText: { fontFamily: fonts.mono, fontSize: 14 },
  title: { fontFamily: fonts.serif, fontSize: 24, fontWeight: '700' as const },
  tagline: { fontFamily: fonts.serif, fontSize: 16, fontStyle: 'italic' as const },
  body: { fontFamily: fonts.sans, fontSize: 15 },
  label: { fontFamily: fonts.sans, fontSize: 13 },
  caption: { fontFamily: fonts.sans, fontSize: 12 },
} as const;

export const radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
