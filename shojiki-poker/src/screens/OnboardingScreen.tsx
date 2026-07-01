import React, { useRef, useState } from 'react';
import { Dimensions, NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/PrimaryButton';
import { colors } from '../theme/colors';
import { fonts, space } from '../theme/typography';

const { width } = Dimensions.get('window');

// 生成画像（Onboarding-1..3）が用意でき次第、各スライドのグラデをImageBackgroundに差し替え。
const SLIDES = [
  { copy: 'その負け、ほんまに運か？', colors: [colors.feltLight, colors.feltDark] as const },
  { copy: '収支を入れるだけ。実力が、数字で出る。', colors: ['#123f31', colors.feltDark] as const },
  { copy: '結果は、1枚で晒せ。', colors: ['#153f2c', colors.feltDark] as const },
];

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) setIndex(i);
  };

  const next = () => {
    if (index < SLIDES.length - 1) {
      scrollRef.current?.scrollTo({ x: (index + 1) * width, animated: true });
    } else {
      onDone();
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {SLIDES.map((s, i) => (
          <LinearGradient key={i} colors={s.colors} style={[styles.slide, { width }]}>
            <View style={[styles.slideInner, { paddingTop: insets.top + 80 }]}>
              {i === 0 ? (
                <View style={styles.brand}>
                  <Text style={styles.brandJp}>正直ポーカー</Text>
                  <Text style={styles.brandEn}>Poker Tracker</Text>
                </View>
              ) : null}
              <Text style={styles.copy}>{s.copy}</Text>
            </View>
          </LinearGradient>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
        <PrimaryButton label={index === SLIDES.length - 1 ? 'はじめる' : '次へ'} onPress={next} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.feltDark },
  slide: { flex: 1 },
  slideInner: { flex: 1, paddingHorizontal: space.xl, gap: space.xl },
  brand: { gap: 2 },
  brandJp: { fontFamily: fonts.serif, fontSize: 26, fontWeight: '700', color: colors.bone },
  brandEn: { fontFamily: fonts.mono, fontSize: 12, color: colors.gold, letterSpacing: 2 },
  copy: { fontFamily: fonts.serif, fontSize: 30, fontWeight: '700', color: colors.gold, lineHeight: 42 },
  footer: { paddingHorizontal: space.xl, gap: space.lg },
  dots: { flexDirection: 'row', gap: space.sm, justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(244,239,228,0.25)' },
  dotActive: { backgroundColor: colors.gold, width: 20 },
});
