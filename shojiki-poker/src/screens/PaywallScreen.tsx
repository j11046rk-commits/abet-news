import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/PrimaryButton';
import { usePro } from '../context/ProContext';
import { colors } from '../theme/colors';
import { fonts, radius, space } from '../theme/typography';

const BENEFITS = [
  '3ヶ月より前の明細をぜんぶ遡って閲覧',
  '月別／期間指定の収支推移グラフ',
  '曜日別・レート別・場所別フィルタ分析',
  'バナー広告なし',
];

export function PaywallScreen({ navigation }: { navigation: { goBack: () => void } }) {
  const insets = useSafeAreaInsets();
  const { isPro, purchasesLive, buyPro, restore } = usePro();
  const [busy, setBusy] = useState(false);

  const onBuy = async () => {
    if (!purchasesLive) {
      Alert.alert(
        '課金は実機ビルドで有効',
        'RevenueCatの本番キーを設定した実機ビルドで購入できます。開発中は設定画面のPro切替でお試しください。',
      );
      return;
    }
    setBusy(true);
    const ok = await buyPro();
    setBusy(false);
    if (ok) {
      Alert.alert('ようこそPro', '過去がぜんぶ開いた。');
      navigation.goBack();
    } else {
      Alert.alert('未完了', '購入は完了しなかった。');
    }
  };

  const onRestore = async () => {
    setBusy(true);
    const ok = await restore();
    setBusy(false);
    Alert.alert(ok ? '復元完了' : '復元なし', ok ? 'Proを復元した。' : '有効な購入が見つからなかった。');
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.feltDark }}
      contentContainerStyle={{ padding: space.xl, paddingTop: insets.top + space.lg, gap: space.lg }}
    >
      <Text style={styles.title}>正直ポーカー Pro</Text>
      <Text style={styles.tagline}>過去は、消すもんやない。開くもんや。</Text>

      <View style={styles.card}>
        {BENEFITS.map((b) => (
          <View key={b} style={styles.benefitRow}>
            <Check size={18} color={colors.green} />
            <Text style={styles.benefitText}>{b}</Text>
          </View>
        ))}
      </View>

      <View style={styles.priceCard}>
        <Text style={styles.priceMain}>月額 ¥300</Text>
        <Text style={styles.priceSub}>または 年額 ¥2,000（2ヶ月ぶんお得）</Text>
        <Text style={styles.trial}>7日間の無料トライアル</Text>
      </View>

      {isPro ? (
        <View style={styles.activeBox}>
          <Text style={styles.activeText}>✓ Pro有効中。過去はぜんぶ開いてる。</Text>
        </View>
      ) : (
        <PrimaryButton label="Proをはじめる（7日間無料）" onPress={onBuy} disabled={busy} />
      )}

      <PrimaryButton label="購入を復元" variant="outline" onPress={onRestore} disabled={busy} />

      <Text style={styles.legal}>
        トライアル終了後に自動更新。App Storeの設定からいつでも解約できます。
        {!purchasesLive ? '\n（開発ビルド: 課金は未接続。設定画面のPro切替でUIを確認できます。）' : ''}
      </Text>

      <PrimaryButton label="閉じる" variant="outline" onPress={() => navigation.goBack()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.serif, fontSize: 28, fontWeight: '700', color: colors.gold },
  tagline: { fontFamily: fonts.serif, fontSize: 16, fontStyle: 'italic', color: colors.bone },
  card: {
    backgroundColor: colors.feltLight,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(201,162,75,0.25)',
  },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  benefitText: { fontFamily: fonts.sans, fontSize: 15, color: colors.bone, flex: 1 },
  priceCard: {
    alignItems: 'center',
    gap: space.xs,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  priceMain: { fontFamily: fonts.mono, fontSize: 28, fontWeight: '700', color: colors.gold },
  priceSub: { fontFamily: fonts.sans, fontSize: 13, color: colors.bone },
  trial: { fontFamily: fonts.sans, fontSize: 12, color: colors.green, marginTop: space.xs },
  activeBox: {
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: 'rgba(127,183,126,0.15)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.green,
  },
  activeText: { fontFamily: fonts.sans, fontSize: 15, color: colors.green, textAlign: 'center' },
  legal: { fontFamily: fonts.sans, fontSize: 11, color: colors.muted, lineHeight: 17 },
});
