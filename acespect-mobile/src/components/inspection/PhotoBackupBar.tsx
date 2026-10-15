import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';
import { getPhotoBackupStatus, subscribePhotoBackup, type PhotoBackupStatus } from '../../services/syncManager';

/** Live counter of photos safely on the server ("312 / 540"), with a plain-words warning for big inspections. Shows nothing until there are photos. */
export function usePhotoBackup(): PhotoBackupStatus {
  const [status, setStatus] = useState<PhotoBackupStatus>(getPhotoBackupStatus());
  useEffect(() => subscribePhotoBackup(setStatus), []);
  return status;
}

const WHY: Record<NonNullable<PhotoBackupStatus['reason']>, string> = {
  connection: 'Waiting for a connection — it will carry on by itself.',
  wifi: 'Waiting for Wi-Fi (your Wi-Fi-only setting is on).',
  job: 'Enter the Job Number to start backing up photos.',
};

export function PhotoBackupBar({ compact = false }: { compact?: boolean }) {
  const s = usePhotoBackup();
  if (s.total === 0) return null;
  const done = s.uploaded >= s.total;
  const pct = Math.min(100, Math.round((s.uploaded / s.total) * 100));
  const big = s.total > 100;
  const tone = done ? colors.success : s.state === 'waiting' ? colors.warning : colors.accentBlueFg;
  return (
    <View style={[styles.box, compact && styles.compact, { borderColor: tone }]} accessibilityRole="progressbar" accessibilityLabel={`${s.uploaded} of ${s.total} photos backed up`}>
      <View style={styles.row}>
        <Text style={[styles.title, { color: tone }]}>
          {done ? `✓ All ${s.total} photos backed up` : `📷 Photos backed up: ${s.uploaded} / ${s.total}`}
        </Text>
        {!done && <Text style={styles.pct}>{pct}%</Text>}
      </View>
      {!done && (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%`, backgroundColor: tone }]} />
        </View>
      )}
      {!done && s.state === 'waiting' && s.reason ? <Text style={styles.note}>{WHY[s.reason]}</Text> : null}
      {!done && s.state === 'waiting' && !s.reason && s.lastError ? <Text style={styles.note}>Paused: {s.lastError}. Retrying.</Text> : null}
      {!done && big && !compact ? (
        <Text style={styles.note}>
          Big inspection: keep the app open and on Wi-Fi until this reaches {s.total} / {s.total}. The screen will stay on while photos are going up.
        </Text>
      ) : null}
      {s.lost > 0 ? <Text style={[styles.note, { color: colors.warning }]}>{s.lost} photo{s.lost === 1 ? '' : 's'} can no longer be found or read and will be left out.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginVertical: spacing.sm, backgroundColor: colors.surface },
  compact: { paddingVertical: spacing.sm, marginVertical: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...typography.caption, fontWeight: '700' },
  pct: { ...typography.caption, color: colors.textMuted },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.progressTrack, marginTop: spacing.xs, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  note: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
});
