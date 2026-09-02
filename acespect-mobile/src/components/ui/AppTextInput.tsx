import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';

interface AppTextInputProps extends TextInputProps {
  label?: string;
  /** Appends a red asterisk to the label. */
  required?: boolean;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  /** Trailing icon (e.g. calendar). Ignored when `password` is set. */
  rightIcon?: keyof typeof Ionicons.glyphMap;
  /** When true, renders a show/hide eye toggle and masks the value. */
  password?: boolean;
  /** Read-only / admin-assigned field — greys the fill, blocks editing. */
  readOnly?: boolean;
  error?: string;
  /** Locked text shown before the editable input, inside the same field box
   * (e.g. "VIC-" ahead of a job number). Static — not part of the TextInput,
   * so it can't be selected, edited, or deleted from the keyboard. */
  prefix?: string;
}

/** Labeled text field. Supports required marker, icons, password, read-only. */
export function AppTextInput({
  label,
  required = false,
  leftIcon,
  rightIcon,
  password = false,
  readOnly = false,
  error,
  prefix,
  style,
  ...rest
}: AppTextInputProps) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(password);

  return (
    <View style={styles.wrapper}>
      {label && (
        <Text style={styles.label}>
          {label}
          {required && <Text style={styles.req}> *</Text>}
        </Text>
      )}
      <View
        style={[
          styles.field,
          focused && styles.fieldFocused,
          readOnly && styles.fieldReadOnly,
          !!error && styles.fieldError,
        ]}
      >
        {leftIcon && (
          <Ionicons
            name={leftIcon}
            size={18}
            color={focused ? colors.primary : colors.textMuted}
            style={styles.leftIcon}
          />
        )}
        {!!prefix && <Text style={styles.prefixText}>{prefix}</Text>}
        <TextInput
          style={[styles.input, readOnly && styles.inputReadOnly, style]}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={hidden}
          editable={!readOnly}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          {...rest}
        />
        {password ? (
          <Ionicons
            name={hidden ? 'eye-outline' : 'eye-off-outline'}
            size={20}
            color={colors.textMuted}
            onPress={() => setHidden((h) => !h)}
            suppressHighlighting
          />
        ) : (
          rightIcon && <Ionicons name={rightIcon} size={18} color={colors.textMuted} />
        )}
      </View>
      {!!error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: '100%' },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  req: { color: colors.danger, fontWeight: '700' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
  },
  fieldFocused: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  fieldReadOnly: { backgroundColor: colors.surfaceAlt, borderStyle: 'dashed' },
  fieldError: { borderColor: colors.danger },
  leftIcon: { marginRight: spacing.md },
  prefixText: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '700',
    marginRight: 2,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  inputReadOnly: { color: colors.textMuted },
  errorText: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
  },
});
