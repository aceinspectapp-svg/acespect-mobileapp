import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography } from '../../theme';
import { InspectionType } from '../../types/inspection';
import { PROPERTY_LABELS } from '../../constants/inspectionData';
import { IconTile } from './IconTile';
import { Radio } from '../ui/Radio';
import { Tag } from '../ui/Tag';

interface InspectionTypeCardProps {
  type: InspectionType;
  selected: boolean;
  onPress: () => void;
  /** Max property chips before collapsing into "+N more". */
  maxChips?: number;
}

/** Selectable card for one inspection type (icon, title, subtitle, chips, radio). */
export function InspectionTypeCard({
  type,
  selected,
  onPress,
  maxChips = 3,
}: InspectionTypeCardProps) {
  // Build chip labels: either the descriptive tags or applicable property names.
  const chipSource = type.tags ?? type.applicableProperties.map((p) => PROPERTY_LABELS[p]);
  const visible = chipSource.slice(0, maxChips);
  const overflow = chipSource.length - visible.length;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        selected && styles.cardSelected,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.header}>
        <IconTile icon={type.icon as keyof typeof Ionicons.glyphMap} accent={type.accent} />
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{type.title}</Text>
          <Text style={styles.subtitle}>{type.subtitle}</Text>
        </View>
        <Radio selected={selected} />
      </View>

      <View style={styles.chips}>
        {visible.map((label) => (
          <Tag key={label} label={label} />
        ))}
        {overflow > 0 && <Tag label={`+${overflow} more`} muted />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  cardSelected: { borderColor: colors.primary, borderWidth: 1.5 },
  pressed: { opacity: 0.92 },
  header: { flexDirection: 'row', alignItems: 'center' },
  titleBlock: { flex: 1, marginLeft: spacing.md },
  title: { ...typography.h3, color: colors.textPrimary },
  subtitle: { ...typography.bodySm, color: colors.textMuted, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm - 2 },
});
