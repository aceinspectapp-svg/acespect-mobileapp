import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '../../theme';

export interface HeaderAction {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
}

interface InspectionHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  /** Trailing action buttons (e.g. save, home). */
  actions?: HeaderAction[];
}

/** Dark gradient header used across inspection-flow screens. */
export function InspectionHeader({ title, subtitle, onBack, actions = [] }: InspectionHeaderProps) {
  return (
    <LinearGradient
      colors={[colors.headerGradientFrom, colors.headerGradientTo]}
      style={styles.header}
    >
      <SafeAreaView edges={['top']}>
        <View style={styles.row}>
          <Pressable
            onPress={onBack}
            disabled={!onBack}
            style={[styles.iconBtn, !onBack && styles.iconBtnHidden]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={20} color={colors.white} />
          </Pressable>

          <View style={styles.titleBlock}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          </View>

          <View style={styles.actions}>
            {actions.map((a) => (
              <Pressable
                key={a.icon}
                onPress={a.onPress}
                style={styles.iconBtn}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={a.accessibilityLabel}
              >
                <Ionicons name={a.icon} size={18} color={colors.white} />
              </Pressable>
            ))}
          </View>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  iconBtnHidden: { opacity: 0, backgroundColor: 'transparent' },
  titleBlock: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.sm },
  title: { ...typography.h3, color: colors.white, fontSize: 18 },
  subtitle: { ...typography.caption, color: colors.textOnDarkMuted, marginTop: 1 },
  actions: { flexDirection: 'row' },
});
