import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Banner } from '../components/Banner';
import { Hero } from '../components/Hero';
import { Card } from '../components/Card';
import { Field } from '../components/Field';
import { Stepper } from '../components/Stepper';
import { PrimaryButton } from '../components/PrimaryButton';
import { RecordRow } from '../components/RecordRow';
import { useData } from '../context/DataContext';
import { mttLevel, mttSampleWarning } from '../logic/levels';
import { formatDateJP, pct, topPct, yen } from '../logic/format';
import { colors, profitColor } from '../theme/colors';
import { fonts, space } from '../theme/typography';

function entryNet(buyin: number, rebuys: number, cash: number): number {
  return cash - buyin * (1 + rebuys);
}

export function TournamentScreen() {
  const { mtt, mttEntries, addMtt, removeMtt } = useData();
  const [buyin, setBuyin] = useState('');
  const [rebuys, setRebuys] = useState(0);
  const [field, setField] = useState('');
  const [finish, setFinish] = useState('');
  const [cash, setCash] = useState('');

  const level = mttLevel(mtt.roi);
  const warning = mttSampleWarning(mtt.count);
  const extraLine =
    mtt.count > 0
      ? `最高賞金 ${yen(mtt.best)}　／　現在ノーマネー ${mtt.streak}連続`
      : null;

  const onRecord = () => {
    const buyinNum = Number(buyin);
    const fieldNum = Number(field);
    const finishNum = Number(finish);
    const cashNum = Number(cash || '0');
    if (!(buyinNum > 0)) return Alert.alert('入力エラー', 'バイインを入れてくれ。');
    if (!(fieldNum > 0)) return Alert.alert('入力エラー', '参加人数を入れてくれ。');
    if (!(finishNum > 0) || finishNum > fieldNum)
      return Alert.alert('入力エラー', '着順は1〜参加人数の範囲で。');
    if (!Number.isFinite(cashNum) || cashNum < 0)
      return Alert.alert('入力エラー', '獲得賞金を正しく（非入賞は0）。');

    addMtt({
      date: Date.now(),
      buyin: buyinNum,
      rebuys,
      field: fieldNum,
      finish: finishNum,
      cash: cashNum,
    });
    setBuyin('');
    setRebuys(0);
    setField('');
    setFinish('');
    setCash('');
  };

  return (
    <Screen bg={require('../assets/bg-tournament.png')}>
      <Banner source={require('../assets/banner-tournament.png')} />
      <Hero
        unitLabel="累計 ROI"
        value={pct(mtt.roi)}
        level={level}
        extraLine={extraLine}
        subs={[
          { label: 'インマネ率', value: pct(mtt.itm) },
          { label: '平均着順', value: Number.isFinite(mtt.avgTop) ? topPct(mtt.avgTop) : '—' },
          { label: '累計収支', value: yen(mtt.mttProfit, true), tint: profitColor(mtt.mttProfit) },
        ]}
        warning={warning}
      />

      <Card style={{ gap: space.md }}>
        <Text style={styles.cardTitle}>トーナメントの結果を記録</Text>
        <View style={styles.row}>
          <Field label="バイイン" value={buyin} onChangeText={setBuyin} placeholder="10000" suffix="円" />
          <Stepper label="リエントリー数" value={rebuys} min={0} max={20} onChange={setRebuys} suffix="回" />
        </View>
        <View style={styles.row}>
          <Field label="参加人数" value={field} onChangeText={setField} placeholder="100" suffix="人" />
          <Field label="自分の着順" value={finish} onChangeText={setFinish} placeholder="12" suffix="位" />
        </View>
        <Field label="獲得賞金（非入賞は 0）" value={cash} onChangeText={setCash} placeholder="0" suffix="円" />
        <PrimaryButton label="＋ この結果を記録" onPress={onRecord} />
      </Card>

      <View>
        <Text style={styles.sectionTitle}>記録（新しい順）</Text>
        {mttEntries.length === 0 ? (
          <Text style={styles.empty}>まだ0戦。ROIは母数がすべて。まず積め。</Text>
        ) : (
          <Card style={{ paddingVertical: 0 }}>
            {mttEntries.map((e) => {
              const net = entryNet(e.buyin, e.rebuys, e.cash);
              const top = e.field > 0 ? topPct((e.finish / e.field) * 100) : '';
              return (
                <RecordRow
                  key={e.id}
                  title={formatDateJP(e.date)}
                  detail={`${e.field}人中 ${e.finish}位（${top}）`}
                  rightPrimary={yen(net, true)}
                  rightPrimaryColor={profitColor(net)}
                  rightSecondary={e.cash > 0 ? yen(e.cash) : 'ノーマネー'}
                  onDelete={() => removeMtt(e.id)}
                />
              );
            })}
          </Card>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '700', color: colors.bone },
  row: { flexDirection: 'row', gap: space.md },
  sectionTitle: { fontFamily: fonts.serif, fontSize: 16, color: colors.bone, marginBottom: space.sm },
  empty: { fontFamily: fonts.sans, fontSize: 13, color: colors.muted, lineHeight: 20 },
});
