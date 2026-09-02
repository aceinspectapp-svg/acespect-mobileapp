import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';

/**
 * Shared, theme-driven versions of the pill/chip/condition-list UI patterns
 * that DrivewaySectionScreen defined locally (private, not reusable). These
 * back the generic field renderers so every section gets consistent styling
 * without duplicating a private component per screen.
 */

/** Single-select pill row. */
export function PillSelect({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.wrap}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.pill, active && styles.pillActive]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.pillText, active && styles.pillTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Multi-select chip row, with an optional "Other (specify)" escape hatch. */
export function ChipMultiSelect({
  options,
  selected,
  onToggle,
  allowOther,
  otherValue,
  onOtherChange,
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (v: string) => void;
  allowOther?: boolean;
  otherValue?: string;
  onOtherChange?: (v: string) => void;
}) {
  const otherActive = selected.includes('other');
  return (
    <View>
      <View style={styles.wrap}>
        {options.map((o) => {
          const active = selected.includes(o.value);
          return (
            <Pressable
              key={o.value}
              onPress={() => onToggle(o.value)}
              style={[styles.pill, active && styles.pillActive]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active }}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{o.label}</Text>
            </Pressable>
          );
        })}
        {allowOther && (
          <Pressable
            onPress={() => onToggle('other')}
            style={[styles.pill, otherActive && styles.pillActive]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: otherActive }}
          >
            <Text style={[styles.pillText, otherActive && styles.pillTextActive]}>Other</Text>
          </Pressable>
        )}
      </View>
      {allowOther && otherActive && (
        <PlainTextInput
          placeholder="Please specify"
          value={otherValue ?? ''}
          onChangeText={onOtherChange ?? (() => {})}
          style={{ marginTop: spacing.sm }}
        />
      )}
    </View>
  );
}

/**
 * Traffic-light fallback for a color-select option that wasn't given an
 * explicit `color` -- most templates built after the original seed don't set
 * one, which used to fall back to flat grey (every row, selected or not,
 * looked identically disabled). Matches on the option label so it works
 * without any template changes; anything that isn't a recognized
 * condition word (e.g. "Varying", "Other") falls back to the app's own blue
 * rather than grey.
 */
function inferConditionColor(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('poor') || l.includes('unsafe')) return '#DC2626';
  if (l.includes('average')) return '#EA580C';
  if (l.includes('fair')) return '#D97706';
  if (l.includes('satisfactory') || l.includes('good')) return '#65A30D';
  if (l.includes('new') || l.includes('excellent')) return '#16A34A';
  return colors.barBlue;
}

/** Single-select, color-coded list (e.g. condition ratings). */
export function ColorSelect({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; color?: string }[];
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      {options.map((o) => {
        const active = value === o.value;
        const color = o.color ?? inferConditionColor(o.label);
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.conditionRow, active && { borderColor: color, backgroundColor: colors.surfaceAlt }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
          >
            <View style={[styles.dot, { backgroundColor: color }]} />
            <Text style={[styles.conditionText, { color: active ? color : colors.textMuted, fontWeight: active ? '700' : '500' }]}>
              {o.label}
            </Text>
            {active && <Ionicons name="checkmark" size={16} color={color} />}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Plain text input matching the field-kit's visual language (used for text/numeric/textarea/"other"). */
export function PlainTextInput({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  maxLength,
  style,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric';
  multiline?: boolean;
  maxLength?: number;
  style?: object;
}) {
  return (
    <TextInput
      style={[styles.input, multiline && styles.inputMultiline, style]}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      value={value}
      onChangeText={onChangeText}
      keyboardType={keyboardType ?? 'default'}
      multiline={multiline}
      maxLength={maxLength}
    />
  );
}

export function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <Text style={styles.fieldLabel}>
      {children}
      {required && <Text style={{ color: colors.danger }}> *</Text>}
    </Text>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pillActive: { borderColor: colors.barBlue, backgroundColor: colors.accentBlue },
  pillText: { ...typography.bodySm, color: colors.textSecondary },
  pillTextActive: { color: colors.barBlue, fontWeight: '700' },
  conditionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  conditionText: { ...typography.bodySm, flex: 1 },
  fieldLabel: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.bodySm,
    color: colors.textPrimary,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
});
