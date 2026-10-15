import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../../theme';
import { AccentKey } from '../../types/inspection';

const ACCENTS: Record<AccentKey, { bg: string; fg: string }> = {
  blue: { bg: colors.accentBlue, fg: colors.accentBlueFg },
  indigo: { bg: colors.accentIndigo, fg: colors.accentIndigoFg },
  green: { bg: colors.accentGreen, fg: colors.accentGreenFg },
  purple: { bg: colors.accentPurple, fg: colors.accentPurpleFg },
};

interface IconTileProps {
  icon: keyof typeof Ionicons.glyphMap;
  accent: AccentKey;
  size?: number;
}

/** Rounded tinted tile holding an inspection-type / property icon. */
export function IconTile({ icon, accent, size = 44 }: IconTileProps) {
  const a = ACCENTS[accent];
  return (
    <View style={[styles.tile, { width: size, height: size, backgroundColor: a.bg }]}>
      <Ionicons name={icon} size={size * 0.5} color={a.fg} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
