import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Hero } from '../components/Hero';
import { Card } from '../components/Card';
import { Field } from '../components/Field';
import { Stepper } from '../components/Stepper';
import { WinLossAmount } from '../components/WinLossAmount';
import { PrimaryButton } from '../components/PrimaryButton';
import { RecordRow } from '../components/RecordRow';
import { useData } from '../context/DataContext';
import { handsPerHour } from '../logic/calc';
import { cashLevel, cashSampleWarning } from '../logic/levels';
import { bb100Text, formatDateJP, yen } from '../logic/format';
import { colors, profitColor } from '../theme/colors';
import { fonts, space } from '../theme/typography';

/** セッション単体の bb/100（一覧の右端サブ表示用）。 */
function sessionBb100(bb: number, hours: number, hph: number, profit: number): number {
  const hands = hours * hph;
  if (bb <= 0 || hands <= 0) return NaN;
  return profit / bb / (hands / 100);
}

export function CashScreen() {
  const { cash, cashSessions, addCash, removeCash } = useData();
  const [bb, setBb] = useState('');
  const [hours, setHours] = useState('');
  const [players, setPlayers] = useState(6);
  const [win, setWin] = useState(true);
  const [amount, setAmount] = useState('');

  const level = cashLevel(cash.bb100);
  const warning = cashSampleWarning(cash.totalHands);

  const onRecord = () => {
    const bbNum = Number(bb);
    const hoursNum = Number(hours);
    const amt = Number(amount);
    if (!(bbNum > 0)) return Alert.alert('入力エラー', '1BBの円額を入れてくれ。');
    if (!(hoursNum > 0)) return Alert.alert('入力エラー', 'プレイ時間を入れてくれ。');
    if (!Number.isFinite(amt) || amt < 0) return Alert.alert('入力エラー', '収支額を正しく入れてくれ。');

    const profit = win ? amt : -amt;
    addCash({
      date: Date.now(),
      bb: bbNum,
      hours: hoursNum,
      players,
      hph: handsPerHour(players),
      profit,
    });
    setBb('');
    setHours('');
    setAmount('');
    setWin(true);
  };

  return (
    <Screen>
      <Hero
        unitLabel="累計 bb/100"
        value={bb100Text(cash.bb100)}
        level={level}
        subs={[
          { label: '時給', value: yen(cash.hourly, true), tint: profitColor(cash.hourly) },
          { label: '累計収支', value: yen(cash.totalProfit, true), tint: profitColor(cash.totalProfit) },
          { label: '推定ハンド', value: Math.round(cash.totalHands).toLocaleString('ja-JP') },
        ]}
        warning={warning}
      />

      <Card style={{ gap: space.md }}>
        <Text style={styles.cardTitle}>キャッシュの結果を記録</Text>
        <View style={styles.row}>
          <Field label="レート (1BB / 円)" value={bb} onChangeText={setBb} placeholder="1000" suffix="円" />
          <Field label="プレイ時間" value={hours} onChangeText={setHours} placeholder="4" suffix="h" />
        </View>
        <Stepper label={`人数（推定 ${handsPerHour(players)} hands/h）`} value={players} onChange={setPlayers} suffix="人" />
        <WinLossAmount label="収支" win={win} amount={amount} onChangeWin={setWin} onChangeAmount={setAmount} />
        <PrimaryButton label="＋ この結果を記録" onPress={onRecord} />
      </Card>

      <View>
        <Text style={styles.sectionTitle}>記録（新しい順）</Text>
        {cashSessions.length === 0 ? (
          <Text style={styles.empty}>まだ記録がない。1回入れてみ。数字は嘘つかん。</Text>
        ) : (
          <Card style={{ paddingVertical: 0 }}>
            {cashSessions.map((s) => (
              <RecordRow
                key={s.id}
                title={formatDateJP(s.date)}
                detail={`${s.hours}h · ${s.players}人 · ${yen(s.bb)}`}
                rightPrimary={yen(s.profit, true)}
                rightPrimaryColor={profitColor(s.profit)}
                rightSecondary={`${bb100Text(sessionBb100(s.bb, s.hours, s.hph, s.profit))} bb/100`}
                onDelete={() => removeCash(s.id)}
              />
            ))}
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
