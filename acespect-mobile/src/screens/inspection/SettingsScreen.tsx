import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { Directory, File, Paths } from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { AppScreenProps } from '../../navigation/types';
import { getWifiOnlySync, setWifiOnlySync, QueuedSubmission } from '../../services/offlineStorage';
import { subscribe as subscribeSyncQueue } from '../../services/syncManager';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Total size + count of whatever's still sitting in the local photo folder -- normally near-zero, since a synced photo's local copy is deleted right after upload (see syncManager.ts). A large number here means photos are stuck waiting to sync. */
function readLocalPhotoStats(): { count: number; bytes: number } {
  try {
    const dir = new Directory(Paths.document, 'inspection-photos');
    if (!dir.exists) return { count: 0, bytes: 0 };
    const files = dir.list().filter((e): e is File => e instanceof File);
    const bytes = files.reduce((sum, f) => sum + (f.size ?? 0), 0);
    return { count: files.length, bytes };
  } catch {
    return { count: 0, bytes: 0 };
  }
}

export function SettingsScreen({ navigation }: AppScreenProps<'Settings'>) {
  const [wifiOnly, setWifiOnly] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [localStats, setLocalStats] = useState({ count: 0, bytes: 0 });
  const [pendingQueue, setPendingQueue] = useState<QueuedSubmission[]>([]);

  useEffect(() => {
    getWifiOnlySync().then((v) => {
      setWifiOnly(v);
      setLoaded(true);
    });
  }, []);

  useEffect(() => subscribeSyncQueue(setPendingQueue), []);

  // Local storage refreshes on focus (a photo may have just been captured or synced away since we last looked).
  useFocusEffect(
    useCallback(() => {
      setLocalStats(readLocalPhotoStats());
    }, []),
  );

  const onToggleWifiOnly = (value: boolean) => {
    setWifiOnly(value);
    void setWifiOnlySync(value);
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <InspectionHeader title="Settings" onBack={() => navigation.goBack()} />

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>SYNC</Text>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Wi-Fi only</Text>
              <Text style={styles.rowHint}>
                Only upload finished inspections automatically when connected to Wi-Fi, not mobile data. You can
                still tap "Retry now" on the pending-sync banner to upload immediately over any connection.
              </Text>
            </View>
            {loaded && (
              <Switch
                value={wifiOnly}
                onValueChange={onToggleWifiOnly}
                trackColor={{ true: colors.primary, false: colors.disabledBg }}
                thumbColor={colors.white}
              />
            )}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>STORAGE ON THIS DEVICE</Text>
          <View style={styles.statRow}>
            <Ionicons name="images-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.statLabel}>Photos not yet synced</Text>
            <Text style={styles.statValue}>{localStats.count}</Text>
          </View>
          <View style={styles.statRow}>
            <Ionicons name="save-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.statLabel}>Local space used</Text>
            <Text style={styles.statValue}>{formatBytes(localStats.bytes)}</Text>
          </View>
          <View style={styles.statRow}>
            <Ionicons name="cloud-upload-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.statLabel}>Inspections waiting to sync</Text>
            <Text style={styles.statValue}>{pendingQueue.length}</Text>
          </View>
          <Text style={styles.footnote}>
            A photo's local copy is deleted automatically as soon as it uploads, so this should stay near zero
            between inspections. A high number here usually means photos are queued and waiting for a connection
            (or for Wi-Fi, if that preference is on above).
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  cardTitle: { ...typography.sectionTitle, color: colors.textSecondary, letterSpacing: 0.5, marginBottom: spacing.md },

  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  rowText: { flex: 1 },
  rowLabel: { ...typography.body, fontWeight: '700', color: colors.textPrimary },
  rowHint: { ...typography.caption, color: colors.textMuted, marginTop: 4, lineHeight: 17 },

  statRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  statLabel: { ...typography.bodySm, color: colors.textSecondary, flex: 1 },
  statValue: { ...typography.bodySm, fontWeight: '700', color: colors.textPrimary },
  footnote: { ...typography.caption, color: colors.textMuted, marginTop: spacing.md, lineHeight: 17 },
});
