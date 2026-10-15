import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';

interface StatusRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  /** Show the trailing green check (auto-initialized = done). */
  done?: boolean;
}

/** A single auto-initialized status row (green tint, icon, label, value, check). */
export function StatusRow({ icon, label, value, done = true }: StatusRowProps) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={colors.statusFg} style={styles.icon} />
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
      </View>
      <Text style={styles.value} numberOfLines={1}>
        {value}
      </Text>
      <Ionicons
        name={done ? 'checkmark' : 'ellipsis-horizontal'}
        size={16}
        color={done ? colors.statusFg : colors.textMuted}
        style={styles.check}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.statusBg,
    borderWidth: 1,
    borderColor: colors.statusBorder,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  icon: { marginRight: spacing.sm },
  text: { marginRight: spacing.sm },
  label: { ...typography.bodySm, fontWeight: '700', color: colors.textPrimary },
  value: { ...typography.caption, color: colors.statusValueFg, flex: 1, textAlign: 'right' },
  check: { marginLeft: spacing.sm },
});
