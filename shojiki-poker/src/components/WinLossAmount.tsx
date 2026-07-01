import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme/colors';
import { fonts, radius, space, type } from '../theme/typography';

/** 勝ち/負けトグル＋額入力（HANDOFF §5-1）。符号付き金額を返す。 */
export function WinLossAmount({
  label,
  win,
  amount,
  onChangeWin,
  onChangeAmount,
}: {
  label: string;
  win: boolean;
  amount: string;
  onChangeWin: (win: boolean) => void;
  onChangeAmount: (t: string) => void;
}) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <View style={styles.toggle}>
          <Pressable
            onPress={() => onChangeWin(true)}
            style={[styles.toggleBtn, win && styles.toggleWin]}
          >
            <Text style={[styles.toggleText, win && styles.toggleTextWin]}>勝ち</Text>
          </Pressable>
          <Pressable
            onPress={() => onChangeWin(false)}
            style={[styles.toggleBtn, !win && styles.toggleLoss]}
          >
            <Text style={[styles.toggleText, !win && styles.toggleTextLoss]}>負け</Text>
          </Pressable>
        </View>
        <View style={styles.amountBox}>
          <Text style={[styles.sign, { color: win ? colors.green : colors.chipRed }]}>
            {win ? '+' : '−'}¥
          </Text>
          <TextInput
            style={styles.amountInput}
            value={amount}
            onChangeText={onChangeAmount}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={colors.muted}
            selectionColor={colors.gold}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...type.label, color: colors.muted },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'stretch' },
  toggle: {
    flexDirection: 'row',
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(244,239,228,0.15)',
  },
  toggleBtn: {
    paddingHorizontal: space.md,
    justifyContent: 'center',
    backgroundColor: colors.feltDark,
  },
  toggleWin: { backgroundColor: 'rgba(127,183,126,0.22)' },
  toggleLoss: { backgroundColor: 'rgba(194,96,63,0.22)' },
  toggleText: { fontFamily: fonts.sans, fontSize: 14, color: colors.muted },
  toggleTextWin: { color: colors.green, fontWeight: '700' },
  toggleTextLoss: { color: colors.chipRed, fontWeight: '700' },
  amountBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.feltDark,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(244,239,228,0.15)',
    paddingHorizontal: space.md,
  },
  sign: { fontFamily: fonts.mono, fontSize: 18 },
  amountInput: { flex: 1, fontFamily: fonts.mono, fontSize: 18, color: colors.bone, paddingVertical: space.md },
});
