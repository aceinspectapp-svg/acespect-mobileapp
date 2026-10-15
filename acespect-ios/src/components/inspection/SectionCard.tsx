import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, shadows, spacing, typography } from '../../theme';

export type SectionAccent = 'blue' | 'orange' | 'purple' | 'green';

const ACCENT_COLOR: Record<SectionAccent, string> = {
  blue: colors.barBlue,
  orange: colors.barOrange,
  purple: colors.barPurple,
  green: colors.barGreen,
};

interface SectionCardProps {
  /** Omit to render the card with no heading (just the accent bar + content). */
  title?: string;
  accent: SectionAccent;
  children: React.ReactNode;
  style?: ViewStyle;
}

/** White card with a colored left-accent bar and an optional uppercase section title. */
export function SectionCard({ title, accent, children, style }: SectionCardProps) {
  return (
    <View style={[styles.card, style]}>
      <View style={[styles.bar, { backgroundColor: ACCENT_COLOR[accent] }]} />
      <View style={styles.body}>
        {title && <Text style={styles.title}>{title}</Text>}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
    overflow: 'hidden',
    ...shadows.card,
  },
  bar: { width: 4 },
  body: { flex: 1, padding: spacing.lg },
  title: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
});
