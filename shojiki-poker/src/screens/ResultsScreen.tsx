import React, { useMemo, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { RecordRow } from '../components/RecordRow';
import { LockedNotice } from '../components/LockedNotice';
import { ShareCard, type ShareData } from '../components/ShareCard';
import { useData } from '../context/DataContext';
import { usePro } from '../context/ProContext';
import { cashLevel, mttLevel } from '../logic/levels';
import { bb100Text, formatDateJP, pct, rangeLabel, topPct, yen } from '../logic/format';
import { partitionByGate } from '../logic/gate';
import type { TimelineItem } from '../types';
import { colors, profitColor } from '../theme/colors';
import { fonts, space } from '../theme/typography';

export function ResultsScreen({ navigation }: { navigation: { navigate: (s: string) => void } }) {
  const { cash, mtt, grand, cashSessions, mttEntries } = useData();
  const { isPro } = usePro();
  const cardRef = useRef<View>(null);
  const [busy, setBusy] = useState(false);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...cashSessions.map((data) => ({ kind: 'cash' as const, date: data.date, data })),
      ...mttEntries.map((data) => ({ kind: 'mtt' as const, date: data.date, data })),
    ];
    return items.sort((a, b) => b.date - a.date);
  }, [cashSessions, mttEntries]);

  const now = Date.now();
  const { visible, lockedCount } = partitionByGate(timeline, isPro, now);

  const allDates = timeline.map((t) => t.date);
  const shareData: ShareData = {
    grandTotal: yen(grand, true),
    grandPositive: grand >= 0,
    bb100: bb100Text(cash.bb100),
    roi: pct(mtt.roi),
    cashLevel: cashLevel(cash.bb100),
    mttLevel: mttLevel(mtt.roi),
    itm: pct(mtt.itm),
    avgTop: Number.isFinite(mtt.avgTop) ? topPct(mtt.avgTop) : '—',
    period: rangeLabel(allDates),
    counts: `${cashSessions.length}件 / ${mttEntries.length}戦`,
  };

  const capture = async (): Promise<string> =>
    captureRef(cardRef, { format: 'png', quality: 1, width: 1080, height: 1080 });

  const onShare = async () => {
    try {
      setBusy(true);
      const uri = await capture();
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('共有不可', 'この端末では共有シートを開けなかった。');
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: '成績カードをシェア' });
    } catch {
      Alert.alert('エラー', '画像の生成に失敗した。もう一度試してくれ。');
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    try {
      setBusy(true);
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('権限が必要', '写真への保存を許可してくれ。');
        return;
      }
      const uri = await capture();
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('保存した', '成績カードを写真に保存した。');
    } catch {
      Alert.alert('エラー', '保存に失敗した。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {/* ① 実収支トータル */}
      <Card style={{ gap: space.xs }}>
        <Text style={styles.headLabel}>実収支トータル</Text>
        <Text style={[styles.headValue, { color: profitColor(grand) }]}>{yen(grand, true)}</Text>
        <View style={styles.breakdown}>
          <Text style={styles.breakItem}>
            💵 キャッシュ{' '}
            <Text style={{ color: profitColor(cash.totalProfit) }}>{yen(cash.totalProfit, true)}</Text>
          </Text>
          <Text style={styles.breakItem}>
            🏆 トーナメント{' '}
            <Text style={{ color: profitColor(mtt.mttProfit) }}>{yen(mtt.mttProfit, true)}</Text>
          </Text>
        </View>
      </Card>

      {/* ② シェア画像 */}
      <View style={{ alignItems: 'center', gap: space.md }}>
        <ShareCard ref={cardRef} data={shareData} />
        <View style={styles.shareBtns}>
          <PrimaryButton label="画像でシェア" onPress={onShare} disabled={busy} style={{ flex: 1 }} />
          <PrimaryButton label="保存" variant="outline" onPress={onSave} disabled={busy} style={{ flex: 1 }} />
        </View>
      </View>

      {/* ③ 全記録一覧（キャッシュ＆トーナメント混在） */}
      <View>
        <Text style={styles.sectionTitle}>全記録</Text>
        {timeline.length === 0 ? (
          <Text style={styles.empty}>まだ記録なし。晒せる数字を作ろう。</Text>
        ) : (
          <Card style={{ paddingVertical: 0 }}>
            {visible.map((it) =>
              it.kind === 'cash' ? (
                <RecordRow
                  key={`c-${it.data.id}`}
                  icon="💵"
                  title={formatDateJP(it.date)}
                  detail={`${it.data.hours}h · ${it.data.players}人`}
                  rightPrimary={yen(it.data.profit, true)}
                  rightPrimaryColor={profitColor(it.data.profit)}
                />
              ) : (
                <RecordRow
                  key={`m-${it.data.id}`}
                  icon="🏆"
                  title={formatDateJP(it.date)}
                  detail={`${it.data.field}人中 ${it.data.finish}位`}
                  rightPrimary={yen(it.data.cash - it.data.buyin * (1 + it.data.rebuys), true)}
                  rightPrimaryColor={profitColor(it.data.cash - it.data.buyin * (1 + it.data.rebuys))}
                  rightSecondary={it.data.cash > 0 ? yen(it.data.cash) : 'ノーマネー'}
                />
              ),
            )}
          </Card>
        )}
        <LockedNotice count={lockedCount} onUnlock={() => navigation.navigate('Paywall')} />
      </View>

      {Platform.OS === 'web' ? (
        <Text style={styles.note}>※ 画像シェア/保存は実機（iOS/Android）で動作します。</Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headLabel: { fontFamily: fonts.sans, fontSize: 13, color: colors.muted },
  headValue: { fontFamily: fonts.mono, fontSize: 40, fontWeight: '700' },
  breakdown: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, marginTop: space.xs },
  breakItem: { fontFamily: fonts.mono, fontSize: 13, color: colors.bone },
  shareBtns: { flexDirection: 'row', gap: space.md, width: '100%' },
  sectionTitle: { fontFamily: fonts.serif, fontSize: 16, color: colors.bone, marginBottom: space.sm },
  empty: { fontFamily: fonts.sans, fontSize: 13, color: colors.muted },
  note: { fontFamily: fonts.sans, fontSize: 11, color: colors.muted, textAlign: 'center' },
});
