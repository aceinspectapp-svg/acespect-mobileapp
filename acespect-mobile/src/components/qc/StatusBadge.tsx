import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, spacing } from '../../theme';
import { QcStatus } from '../../types/qc';

/**
 * Read-only defect-status badge — label/color/meaning come from the server
 * (admin-configurable). Defect status only changes via the lifecycle itself
 * (e.g. a task marked Completed advances it) — a field user never sets it
 * directly, so this is display-only, unlike the old free-change dropdown.
 */
export function StatusBadge({ status }: { status: QcStatus }) {
  return (
    <View style={[styles.pill, { backgroundColor: `${status.color}22` }]}>
      <Text style={[styles.text, { color: status.color }]} numberOfLines={1}>{status.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  text: { fontSize: 12, fontWeight: '700' },
});
