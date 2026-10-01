import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '../../theme';
import { PickerSheet } from './PickerSheet';
import { StatusBadge } from './StatusBadge';
import { QcStatus } from '../../types/qc';

interface StatusPickerProps {
  status: QcStatus;
  statuses: QcStatus[];
  onChange: (status: QcStatus) => void;
}

/** Tappable status pill -- opens a sheet to freely change a defect's lifecycle status, same as the original QC prototype's StatusPill. */
export function StatusPicker({ status, statuses, onChange }: StatusPickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={styles.row}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Status: ${status.label}. Change status`}
      >
        <StatusBadge status={status} />
        <Ionicons name="chevron-down" size={13} color={colors.textMuted} />
      </Pressable>

      <PickerSheet visible={open} title="Status" onClose={() => setOpen(false)}>
        {statuses.map((s) => (
          <Pressable
            key={s.id}
            style={styles.option}
            onPress={() => {
              setOpen(false);
              onChange(s);
            }}
          >
            <View style={styles.optionText}>
              <StatusBadge status={s} />
              <Text style={styles.meaning}>{s.meaning}</Text>
            </View>
            {s.id === status.id && <Ionicons name="checkmark" size={18} color={colors.barBlue} />}
          </Pressable>
        ))}
      </PickerSheet>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  optionText: { flex: 1, gap: spacing.xs, alignItems: 'flex-start' },
  meaning: { ...typography.caption, color: colors.textMuted },
});
