import React from 'react';
import { Platform, View } from 'react-native';
import Constants from 'expo-constants';
import { usePro } from '../context/ProContext';
import { colors } from '../theme/colors';

/**
 * 下部固定バナー広告（HANDOFF §6）。
 * 方針: バナーのみ。インタースティシャル/リワードは使わない。入力・計算の邪魔をしない。
 * Proユーザー・広告オフ時は非表示。ネイティブ未リンク環境では黙って何も描画しない。
 */

type BannerModule = {
  BannerAd: React.ComponentType<{ unitId: string; size: string }>;
  BannerAdSize: Record<string, string>;
  TestIds: Record<string, string>;
};

let ads: BannerModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ads = require('react-native-google-mobile-ads') as BannerModule;
} catch {
  ads = null;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

function bannerUnitId(): string {
  const configured = Platform.OS === 'ios' ? extra.adBannerUnitIdIOS : extra.adBannerUnitIdAndroid;
  // __DEV__ では常にテストID。本番は設定値（無ければテストIDにフォールバック）。
  if (__DEV__ && ads?.TestIds?.BANNER) return ads.TestIds.BANNER;
  return configured ?? ads?.TestIds?.BANNER ?? '';
}

export function AdBanner() {
  const { adsEnabled } = usePro();
  if (!adsEnabled || !ads) return null;

  const { BannerAd, BannerAdSize } = ads;
  return (
    <View style={{ alignItems: 'center', backgroundColor: colors.feltDark }}>
      <BannerAd unitId={bannerUnitId()} size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER} />
    </View>
  );
}
