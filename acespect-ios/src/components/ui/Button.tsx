import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, shadows, spacing, typography } from '../../theme';

type Variant = 'primary' | 'primaryGradient' | 'successGradient' | 'outline';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  /** Ionicons glyph rendered before the label. */
  leftIcon?: keyof typeof Ionicons.glyphMap;
  /** Ionicons glyph rendered after the label (e.g. "Next ›"). */
  rightIcon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
  /** Shrink to content width instead of filling the row. */
  fitContent?: boolean;
}

/**
 * App-wide button.
 *  - `primary`         red CTA (login / brand actions)
 *  - `primaryGradient` blue→navy CTA (inspection flow, e.g. "Next")
 *  - `outline`         light bordered secondary / social action
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  leftIcon,
  rightIcon,
  style,
  fitContent = false,
}: ButtonProps) {
  const isGradient = variant === 'primaryGradient' || variant === 'successGradient';
  const isPrimary = variant === 'primary';
  const onDark = isPrimary || isGradient;
  const isDisabled = disabled || loading;
  const gradientColors: readonly [string, string] =
    variant === 'successGradient'
      ? [colors.ctaGreenFrom, colors.ctaGreenTo]
      : [colors.ctaBlueFrom, colors.ctaBlueTo];

  const inner = loading ? (
    <ActivityIndicator color={onDark ? colors.white : colors.primary} />
  ) : (
    <View style={styles.content}>
      {leftIcon && (
        <Ionicons
          name={leftIcon}
          size={20}
          color={onDark ? colors.white : colors.textPrimary}
          style={styles.iconLeft}
        />
      )}
      <Text
        style={[
          typography.button,
          onDark ? styles.onDarkLabel : styles.outlineLabel,
          isDisabled && styles.disabledLabel,
        ]}
      >
        {label}
      </Text>
      {rightIcon && (
        <Ionicons
          name={rightIcon}
          size={20}
          color={onDark ? colors.white : colors.textPrimary}
          style={styles.iconRight}
        />
      )}
    </View>
  );

  // Gradient variant needs a LinearGradient fill behind the content.
  if (isGradient) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        onPress={onPress}
        disabled={isDisabled}
        style={({ pressed }) => [
          styles.base,
          fitContent && styles.fit,
          !isDisabled && shadows.cta,
          pressed && !isDisabled && styles.pressed,
          isDisabled && styles.gradientDisabledWrap,
          style,
        ]}
      >
        <LinearGradient
          colors={isDisabled ? [colors.disabledBg, colors.disabledBg] : gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.gradientFill}
        >
          {inner}
        </LinearGradient>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        styles.pad,
        fitContent && styles.fit,
        isPrimary ? styles.primary : styles.outline,
        isPrimary && !isDisabled && shadows.cta,
        isDisabled && (isPrimary ? styles.primaryDisabled : styles.outlineDisabled),
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pad: { paddingHorizontal: spacing.lg },
  fit: { alignSelf: 'flex-start', paddingHorizontal: spacing.xxl },
  gradientFill: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  gradientDisabledWrap: { opacity: 0.9 },
  primary: { backgroundColor: colors.primary },
  outline: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  primaryDisabled: { backgroundColor: colors.disabledBg },
  outlineDisabled: { opacity: 0.6 },
  pressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  iconLeft: { marginRight: spacing.sm },
  iconRight: { marginLeft: spacing.sm },
  onDarkLabel: { color: colors.white },
  outlineLabel: { color: colors.textPrimary, letterSpacing: 0.2, fontSize: 15 },
  disabledLabel: { color: colors.disabledFg },
});
