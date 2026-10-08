import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography } from '../../theme';
import { Radio } from '../ui/Radio';
import type { ConstructionStage } from '../../constants/constructionStages';

interface StageRowProps {
  stage: ConstructionStage;
  index: number;
  selected: boolean;
  onPress: () => void;
}

/** One construction stage in the picker: number, name, what it covers. A stage whose form is not ready yet shows "Coming soon" and cannot be chosen. */
export function StageRow({ stage, index, selected, onPress }: StageRowProps) {
  const disabled = !stage.available;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`${stage.title}${disabled ? ', coming soon' : ''}`}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.row, selected && styles.rowSelected, disabled && styles.rowDisabled, pressed && !disabled && styles.pressed]}
    >
      <View style={[styles.num, selected && styles.numSelected, disabled && styles.numDisabled]}>
        <Text style={[styles.numText, (selected || disabled) && { color: selected ? colors.white : colors.disabledFg }]}>{stage.badge ?? index + 1}</Text>
      </View>
      <View style={styles.text}>
        <Text style={[styles.title, disabled && styles.titleDisabled]}>{stage.title}</Text>
        <Text style={[styles.sub, disabled && styles.titleDisabled]} numberOfLines={2}>{stage.subtitle}</Text>
      </View>
      {disabled ? (
        <View style={styles.soon}>
          <Ionicons name="time-outline" size={12} color={colors.textMuted} />
          <Text style={styles.soonText}>Coming soon</Text>
        </View>
      ) : (
        <Radio selected={selected} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.md,
    ...shadows.card,
  },
  rowSelected: { borderColor: colors.accentBlueFg, backgroundColor: colors.accentBlue },
  rowDisabled: { opacity: 0.6 },
  pressed: { opacity: 0.92 },
  num: { minWidth: 32, height: 32, paddingHorizontal: 6, borderRadius: 16, backgroundColor: colors.chipBg, alignItems: 'center', justifyContent: 'center' },
  numSelected: { backgroundColor: colors.accentBlueFg },
  numDisabled: { backgroundColor: colors.disabledBg },
  numText: { ...typography.bodySm, fontWeight: '800', color: colors.textSecondary },
  text: { flex: 1 },
  title: { ...typography.body, fontWeight: '700', color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  titleDisabled: { color: colors.disabledFg },
  soon: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.chipBg },
  soonText: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
});
