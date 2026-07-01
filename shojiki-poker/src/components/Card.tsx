import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { colors } from '../theme/colors';
import { radius, space } from '../theme/typography';

/** 濃緑フェルト面の上に置く、やや明るいカード面。 */
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.feltLight,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(201,162,75,0.18)',
  },
});
