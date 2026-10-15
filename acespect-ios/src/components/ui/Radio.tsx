import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../../theme';

interface RadioProps {
  selected: boolean;
}

/** Presentational radio dot used on selectable cards (selection handled by card). */
export function Radio({ selected }: RadioProps) {
  return (
    <View style={[styles.outer, selected && styles.outerSelected]}>
      {selected && <View style={styles.inner} />}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  outerSelected: { borderColor: colors.primary },
  inner: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
});
