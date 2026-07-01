import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme/colors';
import { fonts, radius, space, type } from '../theme/typography';

/** ラベル付き数値入力（円・時間など）。monospaceで計器感。 */
export function Field({
  label,
  value,
  onChangeText,
  suffix,
  placeholder,
  keyboardType = 'numeric',
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  suffix?: string;
  placeholder?: string;
  keyboardType?: 'numeric' | 'decimal-pad' | 'number-pad';
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          keyboardType={keyboardType}
          selectionColor={colors.gold}
        />
        {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: space.xs },
  label: { ...type.label, color: colors.muted },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.feltDark,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(244,239,228,0.15)',
    paddingHorizontal: space.md,
  },
  input: {
    flex: 1,
    fontFamily: fonts.mono,
    fontSize: 18,
    color: colors.bone,
    paddingVertical: space.md,
  },
  suffix: { fontFamily: fonts.sans, fontSize: 13, color: colors.muted, marginLeft: space.xs },
});
