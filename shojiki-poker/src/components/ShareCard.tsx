import React from 'react';
import { ImageBackground, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { fonts } from '../theme/typography';
import type { Level } from '../logic/levels';

/**
 * シェア用 正方形カード（HANDOFF §5-3, §6）。
 * 生成背景画像が用意でき次第 <ImageBackground> に差し替え可（現状はフェルトのグラデ）。
 * ブランド名「正直ポーカー」を実テキストで焼き込み＝シェア=広告（§6の唯一の集客エンジン）。
 * このViewをview-shotで正方形キャプチャする。
 */
export const SHARE_CARD_SIZE = 320; // 画面上の表示サイズ。view-shotで1080pxに拡大出力。

export type ShareData = {
  grandTotal: string;
  grandPositive: boolean;
  bb100: string;
  roi: string;
  cashLevel: Level;
  mttLevel: Level;
  itm: string;
  avgTop: string;
  period: string;
  counts: string;
};

export const ShareCard = React.forwardRef<View, { data: ShareData }>(({ data }, ref) => {
  const grandColor = data.grandPositive ? colors.green : colors.chipRed;
  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <ImageBackground
        source={require('../assets/share-bg.png')}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />
      {/* 可読性確保のダークスクリム（四隅のチップ上でも文字が沈まないように） */}
      <View style={styles.scrim} pointerEvents="none" />

      {/* ブランドロックアップ */}
      <View style={styles.brand}>
        <Text style={styles.brandJp}>正直ポーカー</Text>
        <Text style={styles.brandEn}>Poker Tracker</Text>
      </View>

      {/* 実収支トータル（ヘッドライン） */}
      <View style={styles.headline}>
        <Text style={styles.headlineLabel}>実収支トータル</Text>
        <Text style={[styles.headlineValue, { color: grandColor }]}>{data.grandTotal}</Text>
      </View>

      {/* KPIグリッド */}
      <View style={styles.grid}>
        <Kpi label="bb/100" value={data.bb100} sub={data.cashLevel.label} />
        <Kpi label="ROI" value={data.roi} sub={data.mttLevel.label} />
        <Kpi label="インマネ率" value={data.itm} />
        <Kpi label="平均着順" value={data.avgTop} />
      </View>

      {/* フッター */}
      <View style={styles.footer}>
        <Text style={styles.meta}>
          {data.period} · {data.counts}
        </Text>
        <Text style={styles.tagline}>勝てば実力、負けたら運を、もう許さない。</Text>
      </View>
    </View>
  );
});
ShareCard.displayName = 'ShareCard';

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
      {sub ? <Text style={styles.kpiSub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: SHARE_CARD_SIZE,
    height: SHARE_CARD_SIZE,
    borderRadius: 20,
    overflow: 'hidden',
    padding: 22,
    justifyContent: 'space-between',
    backgroundColor: colors.feltDark,
  },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.28)' },
  brand: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  brandJp: { fontFamily: fonts.serif, fontSize: 20, fontWeight: '700', color: colors.bone },
  brandEn: { fontFamily: fonts.mono, fontSize: 11, color: colors.gold, letterSpacing: 1 },
  headline: { gap: 2 },
  headlineLabel: { fontFamily: fonts.sans, fontSize: 12, color: colors.muted },
  headlineValue: { fontFamily: fonts.mono, fontSize: 40, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpi: {
    width: (SHARE_CARD_SIZE - 44 - 10) / 2,
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 12,
    padding: 10,
    gap: 1,
  },
  kpiLabel: { fontFamily: fonts.sans, fontSize: 11, color: colors.muted },
  kpiValue: { fontFamily: fonts.mono, fontSize: 20, fontWeight: '700', color: colors.gold },
  kpiSub: { fontFamily: fonts.serif, fontSize: 10, color: colors.bone },
  footer: { gap: 4 },
  meta: { fontFamily: fonts.mono, fontSize: 10, color: colors.muted },
  tagline: { fontFamily: fonts.serif, fontSize: 12, fontStyle: 'italic', color: colors.bone },
});
