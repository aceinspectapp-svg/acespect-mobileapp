import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '../../theme';

export type QcNavTab = 'home' | 'tasks' | 'profile';

interface QcNavBarProps {
  active: QcNavTab;
  onTab: (tab: QcNavTab) => void;
}

const TABS: Array<{ id: QcNavTab; label: string; icon: keyof typeof Ionicons.glyphMap; activeIcon: keyof typeof Ionicons.glyphMap }> = [
  { id: 'home', label: 'Home', icon: 'home-outline', activeIcon: 'home' },
  { id: 'tasks', label: 'Tasks', icon: 'checkbox-outline', activeIcon: 'checkbox' },
  { id: 'profile', label: 'Profile', icon: 'person-outline', activeIcon: 'person' },
];

/** Bottom tab bar for the QC flow's top-level destinations (Home / Tasks / Profile) -- from the original QC prototype, ported as-is. */
export function QcNavBar({ active, onTab }: QcNavBarProps) {
  return (
    <SafeAreaView edges={['bottom']} style={styles.root}>
      <View style={styles.row}>
        {TABS.map(({ id, label, icon, activeIcon }) => {
          const isActive = active === id;
          return (
            <Pressable
              key={id}
              onPress={() => onTab(id)}
              style={styles.tab}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: isActive }}
            >
              <Ionicons name={isActive ? activeIcon : icon} size={22} color={isActive ? colors.primary : colors.textMuted} />
              <Text style={[styles.label, isActive && styles.labelActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  row: { flexDirection: 'row' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, gap: 2 },
  label: { ...typography.caption, fontWeight: '600', color: colors.textMuted },
  labelActive: { color: colors.primary },
});
