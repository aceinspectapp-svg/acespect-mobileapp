import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography } from '../../theme';
import { PropertyType } from '../../types/inspection';
import { Radio } from '../ui/Radio';

interface PropertyTypeRowProps {
  property: PropertyType;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/** Selectable row for a property type (icon + label + radio). */
export function PropertyTypeRow({
  property,
  selected,
  disabled = false,
  onPress,
}: PropertyTypeRowProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        disabled && styles.rowDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <View style={styles.iconWrap}>
        <Ionicons
          name={property.icon as keyof typeof Ionicons.glyphMap}
          size={20}
          color={disabled ? colors.disabledFg : colors.textSecondary}
        />
      </View>
      <Text style={[styles.label, disabled && styles.labelDisabled]}>{property.title}</Text>
      <Radio selected={selected} />
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
    ...shadows.card,
  },
  rowSelected: { borderColor: colors.primary, borderWidth: 1.5 },
  rowDisabled: { opacity: 0.5 },
  pressed: { opacity: 0.92 },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  label: { ...typography.body, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  labelDisabled: { color: colors.disabledFg },
});
