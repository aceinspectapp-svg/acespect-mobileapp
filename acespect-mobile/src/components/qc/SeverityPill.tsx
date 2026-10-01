import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../../theme';
import { QcSeverity } from '../../types/qc';

/**
 * Small colored pill for a defect's severity — label/color come from the
 * server (admin-configurable). A defect's severity is unset until the
 * assigned field user classifies it on-site, so `null` renders a neutral
 * placeholder instead of crashing.
 */
export function SeverityPill({ severity }: { severity: QcSeverity | null }) {
  if (!severity) {
    return (
      <View style={[styles.pill, { backgroundColor: colors.surfaceAlt }]}>
        <Text style={[styles.text, { color: colors.textMuted }]}>Not set</Text>
      </View>
    );
  }
  return (
    <View style={[styles.pill, { backgroundColor: `${severity.color}22` }]}>
      <Text style={[styles.text, { color: severity.color }]}>{severity.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  text: { fontSize: 12, fontWeight: '700' },
});
