import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Minus, Plus } from 'lucide-react-native';
import { colors } from '../theme/colors';
import { fonts, radius, space, type } from '../theme/typography';

/** 人数ステッパー（2〜10・HANDOFF §5-1）。 */
export function Stepper({
  label,
  value,
  min = 2,
  max = 10,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Pressable onPress={dec} style={styles.btn} hitSlop={8}>
          <Minus size={18} color={colors.gold} />
        </Pressable>
        <Text style={styles.value}>
          {value}
          {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
        </Text>
        <Pressable onPress={inc} style={styles.btn} hitSlop={8}>
          <Plus size={18} color={colors.gold} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: space.xs },
  label: { ...type.label, color: colors.muted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.feltDark,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(244,239,228,0.15)',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  btn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(201,162,75,0.12)',
  },
  value: { fontFamily: fonts.mono, fontSize: 20, color: colors.bone, fontWeight: '600' },
  suffix: { fontFamily: fonts.sans, fontSize: 13, color: colors.muted },
});
