import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography } from '../../theme';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { AppScreenProps } from '../../navigation/types';
import * as qc from '../../services/qcPlatformApi';
import { flushQueue } from '../../services/inspectionQueue';

const STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  PLANNED: { label: 'Planned', fg: '#1e40af', bg: '#dbeafe' },
  IN_PROGRESS: { label: 'In progress', fg: '#5b21b6', bg: '#ede9fe' },
  COMPLETED: { label: 'Completed', fg: '#065f46', bg: '#d1fae5' },
  REQUESTED: { label: 'Requested', fg: '#92400e', bg: '#fef3c7' },
  CANCELLED: { label: 'Cancelled', fg: '#475569', bg: '#e2e8f0' },
};

const when = (i: qc.Inspection) =>
  i.plannedFrom ? new Date(i.plannedFrom).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Not scheduled';

/** The inspector's own inspections: what is planned for them, what they have started, what is done. */
export function QcInspectionsListScreen({ navigation }: AppScreenProps<'QcInspections'>) {
  const [items, setItems] = useState<qc.Inspection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await flushQueue().catch(() => undefined); // send anything captured offline first
      setItems(await qc.listInspections());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load inspections');
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = (items ?? []).filter((i) => ['PLANNED', 'IN_PROGRESS'].includes(i.status));
  const done = (items ?? []).filter((i) => !['PLANNED', 'IN_PROGRESS'].includes(i.status));
  const rows = [...open, ...done];

  return (
    <View style={styles.root}>
      <InspectionHeader title="Inspections" subtitle="Assigned to you" onBack={() => navigation.goBack()} />
      {loading && !items && <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={colors.accentBlueFg} />}
      {!!error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={rows}
        keyExtractor={(i) => i.id}
        refreshing={loading}
        onRefresh={load}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const s = STATUS[item.status] ?? { label: item.status, fg: '#475569', bg: '#e2e8f0' };
          return (
            <Pressable onPress={() => navigation.navigate('QcInspection', { inspectionId: item.id })} style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]} accessibilityRole="button" accessibilityLabel={`${item.ref} ${item.stage?.stage_name ?? ''}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{item.ref} · {item.stage?.stage_name ?? item.type}</Text>
                <Text style={styles.sub}>{item.lot ? `Lot ${item.lot.name} · ` : ''}{item.project?.name}</Text>
                <Text style={styles.sub}>{when(item)}</Text>
              </View>
              <View style={[styles.pill, { backgroundColor: s.bg }]}><Text style={[styles.pillText, { color: s.fg }]}>{s.label}</Text></View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          );
        }}
        ListEmptyComponent={!loading && !error ? <Text style={styles.empty}>No inspections assigned to you yet.</Text> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.xl, gap: spacing.md, flexGrow: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, ...shadows.card },
  title: { ...typography.h3, color: colors.textPrimary },
  sub: { ...typography.bodySm, color: colors.textMuted, marginTop: 2 },
  pill: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3 },
  pillText: { ...typography.caption, fontWeight: '700' },
  error: { ...typography.bodySm, color: colors.danger, textAlign: 'center', padding: spacing.lg },
  empty: { ...typography.bodySm, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xxxl },
});
