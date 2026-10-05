import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { AppScreenProps } from '../../navigation/types';
import * as qc from '../../services/qcPlatformApi';

/** Everything that needs your attention. Safety Hazard alerts stay until you acknowledge them. */
export function QcNotificationsScreen({ navigation }: AppScreenProps<'QcNotifications'>) {
  const [items, setItems] = useState<qc.QcNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems((await qc.listNotifications()).notifications);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load notifications');
    } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = async (n: qc.QcNotification) => {
    await qc.markNotificationRead(n.id).catch(() => undefined);
    if (n.entityType === 'QcDefect' && n.entityId) navigation.navigate('QcDefectDetail', { defectId: n.entityId });
    else if (n.entityType === 'QcInspection' && n.entityId) navigation.navigate('QcInspection', { inspectionId: n.entityId });
    load();
  };

  return (
    <View style={styles.root}>
      <InspectionHeader title="Notifications" onBack={() => navigation.goBack()} />
      {loading && !items && <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={colors.accentBlueFg} />}
      {!!error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={items ?? []}
        keyExtractor={(n) => n.id}
        refreshing={loading}
        onRefresh={load}
        contentContainerStyle={styles.list}
        renderItem={({ item: n }) => (
          <Pressable onPress={() => open(n)} style={[styles.card, !n.readAt && styles.unread]} accessibilityRole="button">
            <Ionicons name={n.type === 'defect.safety_hazard' ? 'warning' : 'notifications-outline'} size={20} color={n.type === 'defect.safety_hazard' ? colors.danger : colors.accentBlueFg} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, !n.readAt && { fontWeight: '800' }]}>{n.title}</Text>
              <Text style={styles.sub}>{new Date(n.createdAt).toLocaleString('en-AU')}</Text>
              {n.type === 'defect.safety_hazard' && !n.ackedAt && (
                <Pressable style={styles.ack} onPress={async () => { await qc.ackNotification(n.id); load(); }} accessibilityRole="button">
                  <Text style={styles.ackText}>Acknowledge</Text>
                </Pressable>
              )}
            </View>
          </Pressable>
        )}
        ListEmptyComponent={!loading && !error ? <Text style={styles.empty}>You are all caught up.</Text> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.xl, gap: spacing.md, flexGrow: 1 },
  card: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  unread: { borderColor: colors.accentBlueFg },
  title: { ...typography.body, color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  ack: { alignSelf: 'flex-start', backgroundColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 6, marginTop: spacing.sm },
  ackText: { ...typography.caption, color: colors.white, fontWeight: '800' },
  error: { ...typography.bodySm, color: colors.danger, textAlign: 'center', padding: spacing.lg },
  empty: { ...typography.bodySm, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xxxl },
});
