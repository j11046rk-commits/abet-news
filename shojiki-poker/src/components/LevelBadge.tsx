import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Crown, Flame, TrendingUp, Dice5 } from 'lucide-react-native';
import type { Level } from '../logic/levels';
import { colors } from '../theme/colors';
import { fonts, radius, space } from '../theme/typography';

/**
 * LVバッジ。生成エンブレム画像が用意できるまではベクター（lucide）で代替。
 * tone で色とアイコンを切替（crush=ゴールド, win=グリーン, luck=ミュート, fix=チップレッド）。
 */
const TONE: Record<Level['tone'], { color: string; Icon: typeof Crown }> = {
  crush: { color: colors.gold, Icon: Crown },
  win: { color: colors.green, Icon: TrendingUp },
  luck: { color: colors.muted, Icon: Dice5 },
  fix: { color: colors.chipRed, Icon: Flame },
};

export function LevelBadge({ level, compact }: { level: Level; compact?: boolean }) {
  const { color, Icon } = TONE[level.tone];
  return (
    <View style={[styles.wrap, { borderColor: color }]}>
      <Icon size={compact ? 14 : 16} color={color} />
      <Text style={[styles.label, { color }, compact && { fontSize: 12 }]}>{level.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  label: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '700' },
});
