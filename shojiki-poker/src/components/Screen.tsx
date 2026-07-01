import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { space } from '../theme/typography';

/** フェルト背景＋SafeArea＋スクロールの共通土台。 */
export function Screen({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: space.lg,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.feltDark },
});
