import React from 'react';
import { Image, ImageSourcePropType, StyleSheet } from 'react-native';
import { radius } from '../theme/typography';

/** 各タブ上部の装飾バナー（文字は焼かれていない生成画像）。cover で横帯に切り出す。 */
export function Banner({ source }: { source: ImageSourcePropType }) {
  return <Image source={source} style={styles.banner} resizeMode="cover" />;
}

const styles = StyleSheet.create({
  banner: { width: '100%', height: 140, borderRadius: radius.lg },
});
