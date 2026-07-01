import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CashSession, MttEntry } from '../types';

/**
 * ローカルファースト永続化（HANDOFF §2）。
 * キーはプロトと同一の JSON 構造。データは絶対に消さない（§6）。
 */
export const KEYS = {
  cash: 'cash-sessions',
  mtt: 'mtt-entries',
  pro: 'pro-active',
  onboarded: 'onboarded',
  adsEnabled: 'ads-enabled',
} as const;

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJSON<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export const store = {
  getCashSessions: () => readJSON<CashSession[]>(KEYS.cash, []),
  setCashSessions: (v: CashSession[]) => writeJSON(KEYS.cash, v),

  getMttEntries: () => readJSON<MttEntry[]>(KEYS.mtt, []),
  setMttEntries: (v: MttEntry[]) => writeJSON(KEYS.mtt, v),

  getPro: () => readJSON<boolean>(KEYS.pro, false),
  setPro: (v: boolean) => writeJSON(KEYS.pro, v),

  getOnboarded: () => readJSON<boolean>(KEYS.onboarded, false),
  setOnboarded: (v: boolean) => writeJSON(KEYS.onboarded, v),

  getAdsEnabled: () => readJSON<boolean>(KEYS.adsEnabled, true),
  setAdsEnabled: (v: boolean) => writeJSON(KEYS.adsEnabled, v),

  /** 全記録をJSONで書き出し（設定 → エクスポート・§5-4）。 */
  async exportAll() {
    const [cash, mtt] = await Promise.all([this.getCashSessions(), this.getMttEntries()]);
    return { version: 1, cash, mtt };
  },

  /** 記録データのみ削除（設定 → 削除・§5-4）。課金/オンボ状態は保持。 */
  async clearRecords() {
    await Promise.all([this.setCashSessions([]), this.setMttEntries([])]);
  },
};

/** 衝突しにくいID生成（端末内・タイムスタンプ＋乱数）。 */
export function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
