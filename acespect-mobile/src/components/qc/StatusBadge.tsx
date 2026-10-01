import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, spacing } from '../../theme';
import { QcStatus } from '../../types/qc';

/**
 * Defect-status pill — label/color come from the server (admin-configurable
 * across the 11-stage lifecycle). Purely presentational; DefectDetailScreen
 * wraps it in a Pressable to make it the free status dropdown.
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
