import React from 'react';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors } from '../theme/colors';
import { fonts, radius, space } from '../theme/typography';

export function PrimaryButton({
  label,
  onPress,
  variant = 'gold',
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'gold' | 'outline';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const isGold = variant === 'gold';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        isGold ? styles.gold : styles.outline,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.label, isGold ? styles.labelGold : styles.labelOutline]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gold: { backgroundColor: colors.gold },
  outline: { borderWidth: 1.5, borderColor: colors.gold, backgroundColor: 'transparent' },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.4 },
  label: { fontFamily: fonts.sans, fontSize: 16, fontWeight: '700' },
  labelGold: { color: colors.ink },
  labelOutline: { color: colors.gold },
});
