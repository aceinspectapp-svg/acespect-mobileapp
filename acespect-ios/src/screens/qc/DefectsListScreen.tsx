import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radius, shadows, spacing, typography } from '../../theme';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { SeverityPill } from '../../components/qc/SeverityPill';
import { StatusBadge } from '../../components/qc/StatusBadge';
import { AppScreenProps } from '../../navigation/types';
import { useQcData } from '../../context/QcDataContext';
import { QcDefect } from '../../types/qc';

/**
 * Defects assigned to the signed-in user for ONE property, for viewing/
 * editing their own details -- derived from the same "my tasks" fetch as
 * the Tasks list (one task per defect today), just presented defect-first
 * instead of task-first. Creating a brand-new defect stays admin-only, done
 * from acespect-web.
 */
export function QcDefectsListScreen({ navigation, route }: AppScreenProps<'QcDefectsList'>) {
  const { propertyId } = route.params;
  const { tasks, loading, error, refreshTasks } = useQcData();

  useFocusEffect(
    useCallback(() => {
      refreshTasks();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const defects = useMemo<QcDefect[]>(() => {
    const seen = new Set<string>();
    const result: QcDefect[] = [];
    for (const t of tasks) {
      if (t.defect.property.id !== propertyId) continue;
      if (seen.has(t.defect.id)) continue;
      seen.add(t.defect.id);
      result.push(t.defect);
    }
    return result;
  }, [tasks, propertyId]);

  const first = defects[0];

  return (
    <View style={styles.root}>
      <InspectionHeader
        title="Defects"
        subtitle={first ? `${first.property.name} · ${first.property.propertyType.label}` : undefined}
        onBack={() => navigation.goBack()}
      />

      {loading && defects.length === 0 && (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentBlueFg} />
        </View>
      )}
      {error && defects.length === 0 && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => refreshTasks()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        data={defects}
        keyExtractor={(d) => d.id}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={refreshTasks}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <SeverityPill severity={item.severity} />
              <StatusBadge status={item.status} />
            </View>
            <Pressable onPress={() => navigation.navigate('QcDefectDetail', { defectId: item.id })}>
              <Text style={styles.summary}>{item.title ?? item.summary ?? 'Add defect details →'}</Text>
              {!!item.defectRef && <Text style={styles.ref}>{item.defectRef}{item.isDraft ? ' · Draft' : ''}</Text>}
              <Text style={styles.location}>
                {item.property.name}
                {item.location ? ` · ${item.location}` : ''}
              </Text>
              <View style={styles.cardFooter}>
                <Text style={styles.breadcrumb} numberOfLines={1}>{item.client.name} · {item.project.name}</Text>
                <Text style={styles.due}>{item.dueDate ? `Due ${new Date(item.dueDate).toLocaleDateString()}` : 'No due date'}</Text>
              </View>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={
          !loading && !error ? <Text style={styles.empty}>No defects assigned to you yet.</Text> : null
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
  list: { padding: spacing.lg, paddingBottom: spacing.xxxl, flexGrow: 1 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
  summary: { ...typography.bodySm, fontWeight: '700', color: colors.textPrimary },
  ref: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  location: { ...typography.caption, color: colors.textMuted, marginTop: 2, marginBottom: spacing.sm },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  breadcrumb: { ...typography.caption, color: colors.textSecondary, flexShrink: 1 },
  due: { ...typography.caption, color: colors.textMuted },
  empty: { ...typography.bodySm, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xxxl },
});
