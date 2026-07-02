import React from 'react';
import { ImageBackground, ImageSourcePropType, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { space } from '../theme/typography';

/** フェルト背景＋SafeArea＋スクロールの共通土台。bg を渡すと背景画像＋可読性スクリムを敷く。 */
export function Screen({ children, bg }: { children: React.ReactNode; bg?: ImageSourcePropType }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      {bg ? (
        <>
          <ImageBackground source={bg} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <View style={styles.scrim} pointerEvents="none" />
        </>
      ) : null}
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
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,46,36,0.5)' },
});
