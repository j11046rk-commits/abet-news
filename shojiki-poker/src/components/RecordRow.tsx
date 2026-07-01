import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Trash2 } from 'lucide-react-native';
import { colors } from '../theme/colors';
import { fonts, radius, space } from '../theme/typography';

/**
 * 記録一覧の1行。左に日付+詳細、右に収支、末尾に削除。
 * スワイプ削除の代わりに削除ボタン→確認Alert（v1の簡易実装。§10で将来スワイプ化）。
 */
export function RecordRow({
  icon,
  title,
  detail,
  rightPrimary,
  rightPrimaryColor,
  rightSecondary,
  onDelete,
}: {
  icon?: string; // 💵 / 🏆
  title: string;
  detail: string;
  rightPrimary: string;
  rightPrimaryColor?: string;
  rightSecondary?: string;
  onDelete?: () => void;
}) {
  const confirmDelete = () => {
    if (!onDelete) return;
    Alert.alert('この記録を削除', 'この1件を削除します。累計メーターも再計算されます。', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: onDelete },
    ]);
  };

  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Text style={styles.title}>
          {icon ? `${icon} ` : ''}
          {title}
        </Text>
        <Text style={styles.detail}>{detail}</Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.primary, rightPrimaryColor ? { color: rightPrimaryColor } : null]}>
          {rightPrimary}
        </Text>
        {rightSecondary ? <Text style={styles.secondary}>{rightSecondary}</Text> : null}
      </View>
      {onDelete ? (
        <Pressable onPress={confirmDelete} hitSlop={10} style={styles.delete}>
          <Trash2 size={16} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    gap: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(244,239,228,0.1)',
  },
  left: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.sans, fontSize: 14, color: colors.bone, fontWeight: '600' },
  detail: { fontFamily: fonts.mono, fontSize: 12, color: colors.muted },
  right: { alignItems: 'flex-end', gap: 2 },
  primary: { fontFamily: fonts.mono, fontSize: 15, color: colors.bone, fontWeight: '700' },
  secondary: { fontFamily: fonts.mono, fontSize: 11, color: colors.muted },
  delete: { padding: space.xs },
});
