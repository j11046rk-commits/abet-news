import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import type { TimelineItem } from '../types';
import { yen } from '../logic/format';
import { colors, profitColor } from '../theme/colors';
import { fonts, radius, space } from '../theme/typography';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

/** タイムライン1件の純収支（キャッシュ=profit / トーナメント=賞金-投資）。 */
export function itemNet(it: TimelineItem): number {
  if (it.kind === 'cash') return it.data.profit;
  const m = it.data;
  return m.cash - m.buyin * (1 + m.rebuys);
}

/**
 * 月表示カレンダー。日ごとの純収支を色ドットで示し、タップで日付を選択。
 * 記録のある日だけ選択可。ゲート済みの items を渡すこと（無料は直近3ヶ月）。
 */
export function Calendar({
  items,
  selectedDay,
  onSelectDay,
}: {
  items: TimelineItem[];
  selectedDay: number | null; // 選択日の 0時 epoch、未選択は null
  onSelectDay: (dayStart: number | null) => void;
}) {
  const initial = useMemo(() => {
    const base = items.length ? Math.max(...items.map((i) => i.date)) : Date.now();
    const d = new Date(base);
    return { y: d.getFullYear(), m: d.getMonth() };
    // 初期月のみ。以後はユーザー操作で変更。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [ym, setYm] = useState(initial);

  const byDay = useMemo(() => {
    const map = new Map<number, { net: number; count: number }>();
    for (const it of items) {
      const d = new Date(it.date);
      if (d.getFullYear() !== ym.y || d.getMonth() !== ym.m) continue;
      const key = d.getDate();
      const cur = map.get(key) ?? { net: 0, count: 0 };
      cur.net += itemNet(it);
      cur.count += 1;
      map.set(key, cur);
    }
    return map;
  }, [items, ym]);

  const monthNet = useMemo(() => {
    let sum = 0;
    byDay.forEach((v) => (sum += v.net));
    return sum;
  }, [byDay]);

  const startWeekday = new Date(ym.y, ym.m, 1).getDay();
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const prev = () => {
    onSelectDay(null);
    setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }));
  };
  const next = () => {
    onSelectDay(null);
    setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }));
  };

  const sel = selectedDay != null ? new Date(selectedDay) : null;
  const selInMonth = sel != null && sel.getFullYear() === ym.y && sel.getMonth() === ym.m;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Pressable onPress={prev} hitSlop={10}>
          <ChevronLeft size={22} color={colors.bone} />
        </Pressable>
        <Text style={styles.title}>
          {ym.y}年{ym.m + 1}月
        </Text>
        <Pressable onPress={next} hitSlop={10}>
          <ChevronRight size={22} color={colors.bone} />
        </Pressable>
      </View>

      <Text style={[styles.monthNet, { color: byDay.size ? profitColor(monthNet) : colors.muted }]}>
        {byDay.size ? `月合計 ${yen(monthNet, true)}` : 'この月は記録なし'}
      </Text>

      <View style={styles.weekRow}>
        {WEEK.map((w, i) => (
          <Text key={w} style={[styles.weekCell, i === 0 && { color: colors.chipRed }, i === 6 && { color: '#6E86D6' }]}>
            {w}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((d, idx) => {
          if (d == null) return <View key={idx} style={styles.cell} />;
          const agg = byDay.get(d);
          const isSel = selInMonth && sel!.getDate() === d;
          return (
            <Pressable
              key={idx}
              style={[styles.cell, isSel && styles.cellSel]}
              disabled={!agg}
              onPress={() => onSelectDay(new Date(ym.y, ym.m, d).getTime())}
            >
              <Text style={[styles.dayNum, agg ? styles.dayNumActive : null]}>{d}</Text>
              {agg ? <View style={[styles.dot, { backgroundColor: profitColor(agg.net) }]} /> : <View style={styles.dotEmpty} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '700', color: colors.bone },
  monthNet: { fontFamily: fonts.mono, fontSize: 13, textAlign: 'center' },
  weekRow: { flexDirection: 'row', marginTop: space.xs },
  weekCell: { width: `${100 / 7}%`, textAlign: 'center', fontFamily: fonts.sans, fontSize: 11, color: colors.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: radius.md,
  },
  cellSel: { backgroundColor: 'rgba(201,162,75,0.18)', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.gold },
  dayNum: { fontFamily: fonts.mono, fontSize: 13, color: colors.muted },
  dayNumActive: { color: colors.bone, fontWeight: '700' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotEmpty: { width: 6, height: 6 },
});
