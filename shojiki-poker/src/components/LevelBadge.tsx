import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { Level } from '../logic/levels';
import { colors } from '../theme/colors';
import { fonts, radius, space } from '../theme/typography';

/**
 * LVバッジ。tone に対応した生成エンブレム画像（円形・透過PNG）を表示。
 * crush=黒金ダイヤ章 / win=金章 / luck=銀章 / fix=銅章。枠色は tone のブランドカラー。
 */
const TONE: Record<Level['tone'], { color: string; emblem: number }> = {
  crush: { color: colors.gold, emblem: require('../assets/level-crush.png') },
  win: { color: colors.green, emblem: require('../assets/level-win.png') },
  luck: { color: colors.muted, emblem: require('../assets/level-luck.png') },
  fix: { color: colors.chipRed, emblem: require('../assets/level-fix.png') },
};

export function LevelBadge({ level, compact }: { level: Level; compact?: boolean }) {
  const { color, emblem } = TONE[level.tone];
  const size = compact ? 18 : 22;
  return (
    <View style={[styles.wrap, { borderColor: color }]}>
      <Image source={emblem} style={{ width: size, height: size }} resizeMode="contain" />
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
