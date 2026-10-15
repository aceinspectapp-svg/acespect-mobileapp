import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../../theme';

interface TagProps {
  label: string;
  /** Muted "+N more" style chip. */
  muted?: boolean;
}

/** Small pill/chip shown under inspection-type cards. */
export function Tag({ label, muted = false }: TagProps) {
  return (
    <View style={[styles.tag, muted && styles.tagMuted]}>
      <Text style={[styles.text, muted && styles.textMuted]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.chipBg,
    marginRight: spacing.sm,
    marginTop: spacing.sm,
  },
  tagMuted: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  text: { fontSize: 11.5, fontWeight: '500', color: colors.chipFg },
  textMuted: { color: colors.textMuted },
});
