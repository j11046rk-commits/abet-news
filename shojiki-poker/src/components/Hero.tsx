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
  valueSuffix,
  level,
  subs,
  warning,
  extraLine,
  note,
}: {
  unitLabel: string; // "累計 bb/100" など
  value: string; // 主役数字
  valueSuffix?: string; // 主役数字の後ろに小さく付ける単位（"bb/100" 等）
  level: Level;
  subs: SubStat[];
  warning?: string | null;
  extraLine?: string | null; // 「最高賞金／現在ノーマネー◯連続」など
  note?: string | null; // 指標の意味など控えめな注釈（最下部）
}) {
  return (
    <LinearGradient colors={[colors.feltLight, colors.feltDark]} style={styles.wrap}>
      <Text style={styles.unit}>{unitLabel}</Text>
      <View style={styles.valueRow}>
        <Text style={styles.value}>{value}</Text>
        {valueSuffix ? <Text style={styles.valueSuffix}>{valueSuffix}</Text> : null}
      </View>
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

      {note ? <Text style={styles.note}>{note}</Text> : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, padding: space.xl, gap: space.sm },
  unit: { ...type.label, color: colors.muted, letterSpacing: 1 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs, flexWrap: 'wrap' },
  value: { fontFamily: fonts.mono, fontSize: 52, fontWeight: '700', color: colors.gold },
  valueSuffix: { fontFamily: fonts.mono, fontSize: 18, fontWeight: '700', color: colors.gold, opacity: 0.75 },
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
  note: { fontFamily: fonts.sans, fontSize: 11, color: colors.muted, lineHeight: 16, marginTop: space.sm },
});
