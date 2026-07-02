import React from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { useData } from '../context/DataContext';
import { usePro } from '../context/ProContext';
import { colors } from '../theme/colors';
import { fonts, space } from '../theme/typography';

export function SettingsScreen({
  navigation,
}: {
  navigation: { navigate: (s: string) => void; goBack: () => void };
}) {
  const { isPro, purchasesLive, toggleProLocal } = usePro();
  const { clearAll } = useData();

  const onClear = () => {
    Alert.alert('全記録を削除', '記録データをすべて削除します。取り消せません。', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除する', style: 'destructive', onPress: () => clearAll() },
    ]);
  };

  return (
    <Screen>
      <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.back}>
        <ChevronLeft size={22} color={colors.bone} />
        <Text style={styles.backText}>戻る</Text>
      </Pressable>

      <Text style={styles.h1}>設定</Text>

      <Card style={{ gap: space.md }}>
        <Text style={styles.cardTitle}>プラン</Text>
        <Text style={styles.desc}>Proにすると変わること：</Text>
        <View style={{ gap: 4 }}>
          <Text style={styles.benefit}>・バナー広告が消える</Text>
          <Text style={styles.benefit}>・3ヶ月より前の記録もすべて見られる（無料は直近3ヶ月まで）</Text>
        </View>
        <Row
          label="Pro（開発用の手動切替）"
          desc={purchasesLive ? '通常はストア購入で自動反映。ここは動作確認用。' : '課金は実機ビルドで接続。ここでUIを確認できる。'}
        >
          <Switch value={isPro} onValueChange={toggleProLocal} trackColor={{ true: colors.gold }} />
        </Row>
        <PrimaryButton label={isPro ? 'Pro特典を見る' : 'Proにアップグレード'} variant="outline" onPress={() => navigation.navigate('Paywall')} />
      </Card>

      <Card style={{ gap: space.md }}>
        <Text style={styles.cardTitle}>データ</Text>
        <Text style={styles.desc}>記録は端末内に永続保存されます。</Text>
        <PrimaryButton label="全記録を削除" variant="outline" onPress={onClear} />
      </Card>

      <Card style={{ gap: space.sm }}>
        <Text style={styles.cardTitle}>このアプリについて</Text>
        <Text style={styles.desc}>
          本アプリは自分のプレイ結果を記録・分析する学習/収支管理ツールです。現金の賭博・賭けのシミュレーション・カジノ機能は一切含みません。
        </Text>
      </Card>
    </Screen>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {desc ? <Text style={styles.desc}>{desc}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginBottom: space.sm },
  backText: { fontFamily: fonts.sans, fontSize: 16, color: colors.bone },
  h1: { fontFamily: fonts.serif, fontSize: 24, fontWeight: '700', color: colors.bone },
  cardTitle: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '700', color: colors.gold },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowLabel: { fontFamily: fonts.sans, fontSize: 15, color: colors.bone },
  desc: { fontFamily: fonts.sans, fontSize: 12, color: colors.muted, lineHeight: 18 },
  benefit: { fontFamily: fonts.sans, fontSize: 13, color: colors.bone, lineHeight: 19 },
});
