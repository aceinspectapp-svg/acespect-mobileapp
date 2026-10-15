import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography } from '../../theme';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { PickerSheet } from '../../components/qc/PickerSheet';
import { QcNavBar } from '../../components/qc/QcNavBar';
import { SeverityPill } from '../../components/qc/SeverityPill';
import { AppScreenProps } from '../../navigation/types';
import { useQcData } from '../../context/QcDataContext';
import { useAuth } from '../../context/AuthContext';
import { formatTaskPriority, formatTaskStatus, QcTask, TaskStatus } from '../../types/qc';

const ALL_TASK_STATUSES: TaskStatus[] = ['PENDING', 'IN_PROGRESS', 'COMPLETED'];

const TASK_STATUS_STYLE: Record<TaskStatus, { color: string; bg: string }> = {
  PENDING: { color: '#D97706', bg: '#FFFBEB' },
  IN_PROGRESS: { color: '#059669', bg: '#ECFDF5' },
  COMPLETED: { color: '#475569', bg: '#F1F5F9' },
};
const TASK_PRIORITY_STYLE: Record<QcTask['priority'], { color: string; bg: string }> = {
  HIGH: { color: '#DC2626', bg: '#FEF2F2' },
  MEDIUM: { color: '#EA580C', bg: '#FFF7ED' },
  LOW: { color: '#2563EB', bg: '#EFF6FF' },
};

const FILTERS: Array<TaskStatus | 'All'> = ['All', 'PENDING', 'IN_PROGRESS', 'COMPLETED'];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function QcTasksListScreen({ navigation, route }: AppScreenProps<'QcTasksList'>) {
  const { propertyId } = route.params;
  const { tasks, loading, error, refreshTasks, updateTaskStatus } = useQcData();
  const { signOut } = useAuth();
  const [filter, setFilter] = useState<TaskStatus | 'All'>('All');
  const [statusSheetTaskId, setStatusSheetTaskId] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshTasks();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const propertyTasks = useMemo(() => tasks.filter((t) => t.defect.property.id === propertyId), [tasks, propertyId]);
  const filtered = useMemo(
    () => (filter === 'All' ? propertyTasks : propertyTasks.filter((t) => t.status === filter)),
    [propertyTasks, filter],
  );
  const first = propertyTasks[0]?.defect;

  const onSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  async function onPickStatus(status: TaskStatus) {
    if (!statusSheetTaskId || updatingStatus) return;
    const taskId = statusSheetTaskId;
    setStatusSheetTaskId(null);
    setUpdatingStatus(true);
    try {
      await updateTaskStatus(taskId, status);
    } catch (e) {
      Alert.alert('Could not update status', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setUpdatingStatus(false);
    }
  }

  return (
    <View style={styles.root}>
      <InspectionHeader
        title="Tasks"
        subtitle={first ? `${first.property.name} · ${first.project.name}` : undefined}
        onBack={() => navigation.goBack()}
        actions={[{ icon: 'log-out-outline', onPress: onSignOut, accessibilityLabel: 'Sign out' }]}
      />

      <View style={styles.filterWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <Pressable key={f} onPress={() => setFilter(f)} style={[styles.filterChip, active && styles.filterChipActive]}>
                <Text style={[styles.filterText, active && styles.filterTextActive]}>
                  {f === 'All' ? 'All' : formatTaskStatus(f)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading && propertyTasks.length === 0 && (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentBlueFg} />
        </View>
      )}
      {error && propertyTasks.length === 0 && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => refreshTasks()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={refreshTasks}
        renderItem={({ item }) => {
          const statusStyle = TASK_STATUS_STYLE[item.status];
          const priorityStyle = TASK_PRIORITY_STYLE[item.priority];
          return (
            <Pressable onPress={() => navigation.navigate('QcTaskDetail', { taskId: item.id })} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.cardTopLeft}>
                  <SeverityPill severity={item.defect.severity} />
                  <View style={[styles.pill, { backgroundColor: priorityStyle.bg }]}>
                    <Text style={[styles.pillText, { color: priorityStyle.color }]}>{formatTaskPriority(item.priority)}</Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => setStatusSheetTaskId(item.id)}
                  style={[styles.pill, styles.statusPillBtn, { backgroundColor: statusStyle.bg }]}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Status: ${formatTaskStatus(item.status)}`}
                >
                  <Text style={[styles.pillText, { color: statusStyle.color }]}>{formatTaskStatus(item.status)}</Text>
                  <Ionicons name="chevron-down" size={12} color={statusStyle.color} />
                </Pressable>
              </View>
              <Text style={styles.summary}>{item.defect.title ?? item.defect.summary ?? 'Add defect details →'}</Text>
              <Text style={styles.location}>
                {item.defect.property.name}
                {item.defect.location ? ` · ${item.defect.location}` : ''}
              </Text>
              <View style={styles.cardFooter}>
                <View style={styles.assignee}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials(item.assignedTo.name ?? item.assignedTo.email)}</Text>
                  </View>
                  <Text style={styles.assigneeText} numberOfLines={1}>{item.defect.client.name} · {item.defect.project.name}</Text>
                </View>
                <Text style={styles.due}>{item.dueDate ? `Due ${new Date(item.dueDate).toLocaleDateString()}` : 'No due date'}</Text>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          !loading && !error ? <Text style={styles.empty}>No tasks in this filter.</Text> : null
        }
      />

      <PickerSheet visible={!!statusSheetTaskId} title="Status" onClose={() => setStatusSheetTaskId(null)}>
        {ALL_TASK_STATUSES.map((s) => {
          const style = TASK_STATUS_STYLE[s];
          const current = propertyTasks.find((t) => t.id === statusSheetTaskId)?.status === s;
          return (
            <Pressable key={s} style={styles.statusOption} onPress={() => onPickStatus(s)}>
              <View style={[styles.pill, { backgroundColor: style.bg }]}>
                <Text style={[styles.pillText, { color: style.color }]}>{formatTaskStatus(s)}</Text>
              </View>
              {current && <Ionicons name="checkmark" size={18} color={colors.barBlue} />}
            </Pressable>
          );
        })}
      </PickerSheet>

      <QcNavBar
        active="tasks"
        onTab={(tab) => {
          if (tab === 'home') navigation.navigate('QcPropertyHome', { propertyId });
          else if (tab === 'profile') Alert.alert('Profile', "Profile isn't wired up yet — coming in a later update.");
        }}
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
  filterWrap: { width: '100%', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  filterRow: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  filterText: { ...typography.caption, fontWeight: '700', color: colors.textSecondary },
  filterTextActive: { color: colors.primary },
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
  cardTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
  cardTopLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  pillText: { fontSize: 11, fontWeight: '700' },
  statusPillBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  statusOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  summary: { ...typography.bodySm, fontWeight: '700', color: colors.textPrimary },
  location: { ...typography.caption, color: colors.textMuted, marginTop: 2, marginBottom: spacing.sm },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  assignee: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  avatar: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.accentBlue, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 10, fontWeight: '700', color: colors.accentBlueFg },
  assigneeText: { ...typography.caption, color: colors.textSecondary, flexShrink: 1 },
  due: { ...typography.caption, color: colors.textMuted },
  empty: { ...typography.bodySm, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xxxl },
});
