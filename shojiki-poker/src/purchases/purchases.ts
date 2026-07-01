import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * RevenueCat 配線（HANDOFF §2, §6）。
 * 実キーは app.json の extra（環境変数プレースホルダ）から読む。
 * ネイティブモジュール未リンク（Expo Go 等）やキー未設定でも落ちないよう全て防御的。
 *
 * 実運用手順:
 *   1. RevenueCat ダッシュボードで entitlement "pro" と月額¥300/年額¥2,000のオファリング作成
 *   2. app.json extra.revenueCatApiKeyIOS/Android に本番キーを注入（CIのsecret経由）
 *   3. dev client / 本番ビルドで動作確認（Expo Go では課金は動かない）
 */

type PurchasesModule = typeof import('react-native-purchases').default;

let Purchases: PurchasesModule | null = null;
try {
  // 動的require: ネイティブ未リンク環境ではcatchして無効化
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Purchases = require('react-native-purchases').default as PurchasesModule;
} catch {
  Purchases = null;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
const ENTITLEMENT_ID = extra.revenueCatEntitlementId ?? 'pro';

function apiKey(): string | null {
  const key = Platform.OS === 'ios' ? extra.revenueCatApiKeyIOS : extra.revenueCatApiKeyAndroid;
  if (!key || key.includes('PLACEHOLDER')) return null;
  return key;
}

/** RevenueCatが実際に使える状態か（ネイティブ有り＆本番キー有り）。 */
export function purchasesAvailable(): boolean {
  return Purchases != null && apiKey() != null;
}

/** アプリ起動時に一度だけ呼ぶ。使えなければ黙って何もしない。 */
export async function configurePurchases(): Promise<void> {
  const key = apiKey();
  if (!Purchases || !key) return;
  try {
    await Purchases.configure({ apiKey: key });
  } catch {
    /* 起動をブロックしない */
  }
}

/** 現在Pro entitlementが有効か問い合わせ。使えなければ null（＝ローカルフラグにフォールバック）。 */
export async function fetchProStatus(): Promise<boolean | null> {
  if (!purchasesAvailable() || !Purchases) return null;
  try {
    const info = await Purchases.getCustomerInfo();
    return info.entitlements.active[ENTITLEMENT_ID] != null;
  } catch {
    return null;
  }
}

/** ペイウォールから購入。成功でPro状態(bool)を返す。使えなければ null。 */
export async function purchasePro(): Promise<boolean | null> {
  if (!purchasesAvailable() || !Purchases) return null;
  try {
    const offerings = await Purchases.getOfferings();
    const pkg = offerings.current?.availablePackages?.[0];
    if (!pkg) return null;
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return customerInfo.entitlements.active[ENTITLEMENT_ID] != null;
  } catch {
    return null;
  }
}

/** 購入の復元。 */
export async function restorePro(): Promise<boolean | null> {
  if (!purchasesAvailable() || !Purchases) return null;
  try {
    const info = await Purchases.restorePurchases();
    return info.entitlements.active[ENTITLEMENT_ID] != null;
  } catch {
    return null;
  }
}
