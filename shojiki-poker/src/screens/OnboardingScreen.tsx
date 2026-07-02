import React, { useRef, useState } from 'react';
import { Dimensions, ImageBackground, NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/PrimaryButton';
import { colors } from '../theme/colors';
import { fonts, space } from '../theme/typography';

const { width } = Dimensions.get('window');

// 各スライドの背景は生成画像。文字はアプリ側で実テキスト重ね（画像に文字は焼かない）。
const SLIDES = [
  { copy: 'その負け、ほんまに運か？', bg: require('../assets/onboarding-1.png') },
  { copy: '収支を入れるだけ。実力が、数字で出る。', bg: require('../assets/onboarding-2.png') },
  { copy: '結果は、1枚で晒せ。', bg: require('../assets/onboarding-3.png') },
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
          <ImageBackground key={i} source={s.bg} style={[styles.slide, { width }]} resizeMode="cover">
            <View style={styles.scrim} pointerEvents="none" />
            <View style={[styles.slideInner, { paddingTop: insets.top + 80 }]}>
              {i === 0 ? (
                <View style={styles.brand}>
                  <Text style={styles.brandJp}>正直ポーカー</Text>
                  <Text style={styles.brandEn}>Poker Tracker</Text>
                </View>
              ) : null}
              <Text style={styles.copy}>{s.copy}</Text>
            </View>
          </ImageBackground>
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
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.34)' },
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
