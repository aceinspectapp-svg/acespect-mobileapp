import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography } from '../../theme';

interface ModuleTileProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  iconBg: string;
  iconFg: string;
  onPress: () => void;
  /** Shows a small "Soon" badge — for modules not built yet. */
  soon?: boolean;
}

/** One module card on the QC property home screen (Defects, Tasks, Drawings, ...) -- from the original QC prototype, ported as-is. */
export function ModuleTile({ icon, label, sub, iconBg, iconFg, onPress, soon }: ModuleTileProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {soon && (
        <View style={styles.soonBadge}>
          <Text style={styles.soonText}>Soon</Text>
        </View>
      )}
      <View style={[styles.iconTile, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={24} color={iconFg} />
      </View>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.sub}>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.card,
  },
  pressed: { opacity: 0.9 },
  soonBadge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    backgroundColor: colors.chipBg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  soonText: { ...typography.caption, fontWeight: '700', color: colors.chipFg, fontSize: 10 },
  iconTile: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  label: { ...typography.h3, fontSize: 15, color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
});
