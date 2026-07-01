import React from 'react';
import { Alert, Linking, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { useData } from '../context/DataContext';
import { usePro } from '../context/ProContext';
import { store } from '../storage/store';
import { colors } from '../theme/colors';
import { fonts, space } from '../theme/typography';

// 責任あるプレイの相談先（日本）。
const RESPONSIBLE_PLAY_URL = 'https://www.gamblers-anonymous.jp/';

export function SettingsScreen({ navigation }: { navigation: { navigate: (s: string) => void } }) {
  const { isPro, adsEnabled, purchasesLive, toggleProLocal, setAdsEnabled } = usePro();
  const { clearAll } = useData();

  const onExport = async () => {
    const dump = await store.exportAll();
    try {
      await Share.share({ message: JSON.stringify(dump, null, 2) });
    } catch {
      Alert.alert('エラー', 'エクスポートに失敗した。');
    }
  };

  const onClear = () => {
    Alert.alert('全記録を削除', '記録データをすべて削除します。取り消せません。', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除する', style: 'destructive', onPress: () => clearAll() },
    ]);
  };

  return (
    <Screen>
      <Text style={styles.h1}>設定</Text>

      <Card style={{ gap: space.md }}>
        <Text style={styles.cardTitle}>プラン</Text>
        <Row
          label="Pro（開発用の手動切替）"
          desc={purchasesLive ? '本番課金が接続済み。通常はストア経由で自動反映。' : '課金は実機ビルドで接続。ここでUIを確認できる。'}
        >
          <Switch value={isPro} onValueChange={toggleProLocal} trackColor={{ true: colors.gold }} />
        </Row>
        <PrimaryButton label={isPro ? 'Pro特典を見る' : 'Proにアップグレード'} variant="outline" onPress={() => navigation.navigate('Paywall')} />
      </Card>

      <Card style={{ gap: space.md }}>
        <Text style={styles.cardTitle}>広告</Text>
        <Row label="バナー広告を表示" desc={isPro ? 'Proは常に非表示。' : '下部に控えめなバナー。Proでオフにできる。'}>
          <Switch
            value={adsEnabled}
            onValueChange={setAdsEnabled}
            disabled={isPro}
            trackColor={{ true: colors.gold }}
          />
        </Row>
      </Card>

      <Card style={{ gap: space.md }}>
        <Text style={styles.cardTitle}>データ</Text>
        <Text style={styles.desc}>記録は端末内に永続保存。バックアップにJSONで書き出せる。</Text>
        <PrimaryButton label="データをエクスポート（JSON）" variant="outline" onPress={onExport} />
        <PrimaryButton label="全記録を削除" variant="outline" onPress={onClear} />
      </Card>

      <Card style={{ gap: space.sm }}>
        <Text style={styles.cardTitle}>このアプリについて</Text>
        <Text style={styles.desc}>
          本アプリは自分のプレイ結果を記録・分析する学習/収支管理ツールです。現金の賭博・賭けのシミュレーション・カジノ機能は一切含みません。
        </Text>
        <Text style={styles.link} onPress={() => Linking.openURL(RESPONSIBLE_PLAY_URL)}>
          責任あるプレイ・依存の相談先 →
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
  h1: { fontFamily: fonts.serif, fontSize: 24, fontWeight: '700', color: colors.bone },
  cardTitle: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '700', color: colors.gold },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowLabel: { fontFamily: fonts.sans, fontSize: 15, color: colors.bone },
  desc: { fontFamily: fonts.sans, fontSize: 12, color: colors.muted, lineHeight: 18 },
  link: { fontFamily: fonts.sans, fontSize: 14, color: colors.gold, marginTop: space.xs },
});
