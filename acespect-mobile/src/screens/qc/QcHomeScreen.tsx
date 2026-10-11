import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography } from '../../theme';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { AppScreenProps } from '../../navigation/types';
import { useQcData } from '../../context/QcDataContext';
import { SyncBanner } from '../../components/qc/SyncBanner';
import { useDefectSync } from '../../hooks/useDefectSync';
import { qcMe } from '../../services/qcPlatformApi';
import { setActiveClientId } from '../../services/apiClient';
import { registerForPush } from '../../services/pushRegistration';

interface PropertyCard {
  propertyId: string;
  propertyName: string;
  projectName: string;
  clientName: string;
  defectCount: number;
}

/**
 * QC's landing screen -- the properties you have assigned work in, derived
 * from your own assigned tasks (one task per defect today), same as the old
 * branch's property picker. Tapping one opens QcPropertyHomeScreen's module
 * grid, scoped to just that property's Defects/Tasks. Client/project/
 * property config and defect creation stay admin-only on acespect-web.
 */
export function QcHomeScreen({ navigation }: AppScreenProps<'QcHome'>) {
  const { tasks, loading, error, refreshTasks } = useQcData();
  const sync = useDefectSync();
  const [pickClient, setPickClient] = React.useState<Array<{ id: string; name: string; role: string }> | null>(null);
  const [caps, setCaps] = React.useState<string[]>([]);

  const loadMe = useCallback(async () => {
    try {
      const me = await qcMe();
      setPickClient(null);
      setCaps(me.capabilities);
      registerForPush();
    } catch (e) {
      const body = (e as { response?: { status?: number; data?: { error?: { code?: string; details?: { clients?: Array<{ id: string; name: string; role: string }> } } } } }).response;
      // A person with roles in several clients names the one they are working in.
      if (body?.data?.error?.code === 'CONTEXT_REQUIRED' && body.data.error.details?.clients) setPickClient(body.data.error.details.clients);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadMe();
      refreshTasks();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const properties = useMemo<PropertyCard[]>(() => {
    const byId = new Map<string, PropertyCard>();
    const defectIdsByProperty = new Map<string, Set<string>>();
    for (const t of tasks) {
      const p = t.defect.property;
      if (!byId.has(p.id)) {
        byId.set(p.id, {
          propertyId: p.id,
          propertyName: p.name,
          projectName: t.defect.project.name,
          clientName: t.defect.client.name,
          defectCount: 0,
        });
        defectIdsByProperty.set(p.id, new Set());
      }
      defectIdsByProperty.get(p.id)!.add(t.defect.id);
    }
    for (const card of byId.values()) card.defectCount = defectIdsByProperty.get(card.propertyId)!.size;
    return Array.from(byId.values()).sort((a, b) => a.propertyName.localeCompare(b.propertyName));
  }, [tasks]);

  const has = (c: string) => caps.includes(c);
  const tiles: Array<{ key: string; icon: keyof typeof Ionicons.glyphMap; label: string; sub: string; bg: string; fg: string; show: boolean; go: () => void }> = [
    { key: 'defects', icon: 'alert-circle-outline', label: 'Defects', sub: 'Everything you can see', bg: colors.primaryTint, fg: colors.danger, show: has('defects.view'), go: () => navigation.navigate('QcMyDefects') },
    { key: 'new', icon: 'add-circle-outline', label: 'New defect', sub: 'Raise one on site', bg: colors.accentBlue, fg: colors.accentBlueFg, show: has('defects.create'), go: () => navigation.navigate('QcNewDefect') },
    { key: 'insp', icon: 'clipboard-outline', label: 'Inspections', sub: 'Start, record, sign', bg: colors.accentGreen, fg: colors.accentGreenFg, show: has('inspections.progress'), go: () => navigation.navigate('QcInspections') },
    { key: 'proj', icon: 'folder-open-outline', label: 'Projects', sub: 'Documents and drawings', bg: colors.accentIndigo, fg: colors.accentIndigoFg, show: has('projects.view'), go: () => navigation.navigate('QcProjects') },
  ];

  return (
    <View style={styles.root}>
      <InspectionHeader
        title="QC"
        subtitle="Client & project defect tracking"
        onBack={() => navigation.goBack()}
        actions={[
          { icon: 'notifications-outline', onPress: () => navigation.navigate('QcNotifications'), accessibilityLabel: 'Notifications' },
          { icon: 'person-circle-outline', onPress: () => navigation.navigate('QcAccount'), accessibilityLabel: 'Account' },
        ]}
      />

      <SyncBanner pending={sync.pending} failed={sync.failed} syncing={sync.syncing} onPress={() => (sync.failed ? navigation.navigate('QcAccount') : void sync.syncNow())} />

      {loading && properties.length === 0 && (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentBlueFg} />
        </View>
      )}
      {error && properties.length === 0 && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => refreshTasks()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {pickClient && (
        <View style={styles.pick}>
          <Text style={styles.cardTitle}>Which client are you working in?</Text>
          {pickClient.map((c) => (
            <Pressable key={c.id} style={styles.pickBtn} onPress={() => { setActiveClientId(c.id); loadMe(); refreshTasks(); }} accessibilityRole="button">
              <Text style={styles.cardTitle}>{c.name}</Text>
              <Text style={styles.cardSub}>{c.role.replace(/_/g, ' ').toLowerCase()}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <FlatList
        data={properties}
        ListHeaderComponent={
          <View>
            <View style={styles.tileGrid}>
              {tiles.filter((t) => t.show).map((t) => (
                <Pressable key={t.key} onPress={t.go} style={({ pressed }) => [styles.tile, pressed && styles.cardPressed]} accessibilityRole="button" accessibilityLabel={t.label}>
                  <View style={[styles.tileIcon, { backgroundColor: t.bg }]}>
                    <Ionicons name={t.icon} size={24} color={t.fg} />
                  </View>
                  <Text style={styles.tileLabel}>{t.label}</Text>
                  <Text style={styles.tileSub}>{t.sub}</Text>
                </Pressable>
              ))}
            </View>
            {properties.length > 0 && <Text style={styles.sectionLabel}>YOUR ASSIGNED PROPERTIES</Text>}
          </View>
        }
        keyExtractor={(p) => p.propertyId}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={refreshTasks}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate('QcPropertyHome', { propertyId: item.propertyId })}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            accessibilityRole="button"
            accessibilityLabel={item.propertyName}
          >
            <View style={styles.iconTile}>
              <Ionicons name="business-outline" size={26} color={colors.accentBlueFg} />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>{item.propertyName}</Text>
              <Text style={styles.cardSub}>{item.projectName} · {item.clientName}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </Pressable>
        )}
        ListEmptyComponent={
          !loading && !error ? <Text style={styles.empty}>No properties with assigned tasks yet.</Text> : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxxl, gap: spacing.md },
  errorText: { ...typography.bodySm, color: colors.danger, textAlign: 'center' },
  retryBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primaryTint },
  retryText: { ...typography.bodySm, color: colors.primary, fontWeight: '700' },
  list: { padding: spacing.xl, paddingBottom: spacing.xxxl, flexGrow: 1, gap: spacing.lg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.card,
  },
  cardPressed: { opacity: 0.92 },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.lg },
  tile: { width: '48%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, ...shadows.card },
  tileIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  tileLabel: { ...typography.h3, color: colors.textPrimary },
  tileSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  sectionLabel: { ...typography.sectionTitle, color: colors.textMuted, marginBottom: spacing.md },
  iconTile: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.accentBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, marginLeft: spacing.lg },
  cardTitle: { ...typography.h3, color: colors.textPrimary },
  cardSub: { ...typography.bodySm, color: colors.textMuted, marginTop: 2 },
  empty: { ...typography.bodySm, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xxxl },
  pick: { padding: spacing.xl, gap: spacing.md },
  pickBtn: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
});
