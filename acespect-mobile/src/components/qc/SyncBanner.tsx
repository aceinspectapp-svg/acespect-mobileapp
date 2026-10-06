import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';

/** "3 changes waiting to send" with a send-now tap; red when the server refused some. */
export function SyncBanner({ pending, failed, syncing, onPress }: { pending: number; failed: number; syncing: boolean; onPress: () => void }) {
  if (pending === 0) return null;
  const bad = failed > 0;
  return (
    <Pressable onPress={onPress} style={[styles.bar, bad && styles.bad]} accessibilityRole="button" accessibilityLabel="Send waiting changes">
      <Ionicons name={bad ? 'alert-circle-outline' : 'cloud-upload-outline'} size={18} color={bad ? colors.danger : colors.accentBlueFg} />
      <View style={{ flex: 1 }}>
        <Text style={styles.text}>
          {syncing ? 'Sending…' : `${pending} change${pending === 1 ? '' : 's'} waiting to send`}
          {bad ? ` · ${failed} need attention` : ''}
        </Text>
        <Text style={styles.sub}>{bad ? 'Open Account › Waiting to send to review them.' : 'Tap to send now. They send on their own when you are back online.'}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accentBlue },
  bad: { backgroundColor: colors.primaryTint },
  text: { ...typography.bodySm, fontWeight: '700', color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
});
