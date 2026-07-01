import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { Level } from '../logic/levels';
import { LevelBadge } from './LevelBadge';
import { colors } from '../theme/colors';
import { fonts, radius, space, type } from '../theme/typography';

export type SubStat = { label: string; value: string; tint?: string };

/**
 * ヒーロー（HANDOFF §5-1 / §5-2）。
 * 主役数字（ゴールド大）＋LVバッジ＋辛口コピー＋サブ指標＋サンプル警告。
 */
export function Hero({
  unitLabel,
  value,
  level,
  subs,
  warning,
  extraLine,
}: {
  unitLabel: string; // "累計 bb/100" など
  value: string; // 主役数字
  level: Level;
  subs: SubStat[];
  warning?: string | null;
  extraLine?: string | null; // 「最高賞金／現在ノーマネー◯連続」など
}) {
  return (
    <LinearGradient colors={[colors.feltLight, colors.feltDark]} style={styles.wrap}>
      <Text style={styles.unit}>{unitLabel}</Text>
      <Text style={styles.value}>{value}</Text>
      <View style={styles.badgeRow}>
        <LevelBadge level={level} />
      </View>
      <Text style={styles.line}>{level.line}</Text>

      {extraLine ? <Text style={styles.extra}>{extraLine}</Text> : null}

      <View style={styles.subRow}>
        {subs.map((s) => (
          <View key={s.label} style={styles.sub}>
            <Text style={styles.subLabel}>{s.label}</Text>
            <Text style={[styles.subValue, s.tint ? { color: s.tint } : null]}>{s.value}</Text>
          </View>
        ))}
      </View>

      {warning ? (
        <View style={styles.warnBox}>
          <Text style={styles.warnText}>{warning}</Text>
        </View>
      ) : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, padding: space.xl, gap: space.sm },
  unit: { ...type.label, color: colors.muted, letterSpacing: 1 },
  value: { fontFamily: fonts.mono, fontSize: 52, fontWeight: '700', color: colors.gold },
  badgeRow: { flexDirection: 'row' },
  line: { fontFamily: fonts.serif, fontSize: 16, fontStyle: 'italic', color: colors.bone },
  extra: { fontFamily: fonts.mono, fontSize: 13, color: colors.muted, marginTop: space.xs },
  subRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.lg,
    marginTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(244,239,228,0.12)',
    paddingTop: space.md,
  },
  sub: { gap: 2 },
  subLabel: { ...type.caption, color: colors.muted },
  subValue: { fontFamily: fonts.mono, fontSize: 15, color: colors.bone, fontWeight: '600' },
  warnBox: {
    marginTop: space.sm,
    backgroundColor: 'rgba(194,96,63,0.15)',
    borderRadius: radius.md,
    padding: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(194,96,63,0.4)',
  },
  warnText: { fontFamily: fonts.sans, fontSize: 12, color: colors.chipRed, lineHeight: 17 },
});
