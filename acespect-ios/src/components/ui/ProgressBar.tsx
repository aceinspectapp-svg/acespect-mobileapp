import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius } from '../../theme';

interface ProgressBarProps {
  /** Progress 0..1. */
  progress: number;
  height?: number;
}

/** Thin rounded progress bar (inspection setup steps). */
export function ProgressBar({ progress, height = 6 }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <View style={[styles.track, { height }]}>
      <View style={[styles.fill, { width: `${pct}%`, height }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: colors.progressTrack,
    borderRadius: radius.pill,
    overflow: 'hidden',
    width: '100%',
  },
  fill: { backgroundColor: colors.progressFill, borderRadius: radius.pill },
});
