import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import { colors } from '../theme/colors';
import { fonts, radius, space } from '../theme/typography';

/**
 * 無料ユーザーに「3ヶ月より前が◯件ロック中」を提示（HANDOFF §6）。
 * "消す" ではなく "開く" 体験。タップでペイウォールへ。
 */
export function LockedNotice({ count, onUnlock }: { count: number; onUnlock: () => void }) {
  if (count <= 0) return null;
  return (
    <Pressable onPress={onUnlock} style={styles.wrap}>
      <Lock size={16} color={colors.gold} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>3ヶ月より前の記録が{count}件</Text>
        <Text style={styles.sub}>Proで過去がぜんぶ開く。タップで解錠。</Text>
      </View>
      <Text style={styles.cta}>開く →</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: 'rgba(201,162,75,0.1)',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(201,162,75,0.35)',
    padding: space.md,
    marginTop: space.md,
  },
  title: { fontFamily: fonts.sans, fontSize: 14, color: colors.bone, fontWeight: '600' },
  sub: { fontFamily: fonts.sans, fontSize: 12, color: colors.muted },
  cta: { fontFamily: fonts.sans, fontSize: 14, color: colors.gold, fontWeight: '700' },
});
