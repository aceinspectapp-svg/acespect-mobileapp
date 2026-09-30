import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, spacing } from '../../theme';
import { QcSeverity } from '../../types/qc';

/** Small colored pill for a defect's severity — label/color come from the server (admin-configurable). */
export function SeverityPill({ severity }: { severity: QcSeverity }) {
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
