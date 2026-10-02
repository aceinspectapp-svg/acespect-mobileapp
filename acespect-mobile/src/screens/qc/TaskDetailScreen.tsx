import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { PickerSheet } from '../../components/qc/PickerSheet';
import { Button, Checkbox } from '../../components/ui';
import { AppScreenProps } from '../../navigation/types';
import { useQcData } from '../../context/QcDataContext';
import { useQcPhotoCapture } from '../../hooks/useQcPhotoCapture';
import { formatTaskStatus, QcPhoto, QcTask, TaskStatus } from '../../types/qc';

const TASK_STATUS_STYLE: Record<TaskStatus, { color: string; bg: string }> = {
  PENDING: { color: '#D97706', bg: '#FFFBEB' },
  IN_PROGRESS: { color: '#059669', bg: '#ECFDF5' },
  COMPLETED: { color: '#475569', bg: '#F1F5F9' },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "23 Sep, 14:32" — compact enough for an activity feed timestamp. */
function formatUpdateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${time}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

const ALL_TASK_STATUSES: TaskStatus[] = ['PENDING', 'IN_PROGRESS', 'COMPLETED'];

export function QcTaskDetailScreen({ navigation, route }: AppScreenProps<'QcTaskDetail'>) {
  const { taskId } = route.params;
  const { getTask, postTaskUpdate, updateTaskStatus } = useQcData();
  const { takePhoto, pickFromLibrary } = useQcPhotoCapture();

  const [task, setTask] = useState<QcTask | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updateSheetOpen, setUpdateSheetOpen] = useState(false);
  const [statusSheetOpen, setStatusSheetOpen] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [comment, setComment] = useState('');
  const [markCompleted, setMarkCompleted] = useState(false);
  const [photos, setPhotos] = useState<QcPhoto[]>([]);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  function load() {
    getTask(taskId)
      .then(setTask)
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load task'));
  }
  useEffect(load, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetUpdateForm = () => {
    setUpdateSheetOpen(false);
    setComment('');
    setMarkCompleted(false);
    setPhotos([]);
    setPostError(null);
  };

  async function onCapturePhoto() {
    const result = await takePhoto();
    if (result) setPhotos((prev) => [...prev, ...result]);
  }
  async function onAddPhoto() {
    const result = await pickFromLibrary();
    if (result) setPhotos((prev) => [...prev, ...result]);
  }
  function onRemovePhoto(id: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  async function onPickStatus(status: TaskStatus) {
    if (changingStatus) return;
    setStatusSheetOpen(false);
    setChangingStatus(true);
    try {
      await updateTaskStatus(taskId, status);
      load();
    } catch (e) {
      Alert.alert('Could not update status', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setChangingStatus(false);
    }
  }

  const canPost = !!comment.trim() || photos.length > 0;

  async function onPostUpdate() {
    if (!canPost || posting) return;
    setPosting(true);
    setPostError(null);
    try {
      await postTaskUpdate(taskId, comment, markCompleted, photos.map((p) => p.uri));
      resetUpdateForm();
      load();
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Failed to post update');
    } finally {
      setPosting(false);
    }
  }

  if (loadError) {
    return (
      <View style={styles.root}>
        <InspectionHeader title="Task" onBack={() => navigation.goBack()} />
        <View style={styles.missing}>
          <Text style={styles.missingText}>{loadError}</Text>
        </View>
      </View>
    );
  }

  if (!task) {
    return (
      <View style={styles.root}>
        <InspectionHeader title="Task" onBack={() => navigation.goBack()} />
        <View style={styles.missing}>
          <ActivityIndicator color={colors.accentBlueFg} />
        </View>
      </View>
    );
  }

  const s = TASK_STATUS_STYLE[task.status];
  const updates = [...(task.updates ?? [])].reverse(); // newest first

  return (
    <View style={styles.root}>
      <InspectionHeader title={task.defect.title ?? task.defect.summary ?? 'Untitled defect'} subtitle={task.defect.property.name} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Status</Text>
          <Pressable
            style={styles.statusRow}
            onPress={() => setStatusSheetOpen(true)}
            disabled={changingStatus}
            accessibilityRole="button"
            accessibilityLabel={`Status: ${formatTaskStatus(task.status)}`}
          >
            <View style={[styles.statusPill, { backgroundColor: s.bg }]}>
              <Text style={[styles.statusPillText, { color: s.color }]}>{formatTaskStatus(task.status)}</Text>
            </View>
            {changingStatus ? (
              <ActivityIndicator size="small" color={colors.textMuted} />
            ) : (
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            )}
          </Pressable>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Defect</Text>
          <Pressable onPress={() => navigation.navigate('QcDefectDetail', { defectId: task.defect.id })}>
            <Text style={styles.link}>{task.defect.title ?? task.defect.summary ?? 'Add defect details →'}</Text>
          </Pressable>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Location</Text>
          <Text style={styles.fieldValue}>
            {task.defect.client.name} · {task.defect.project.name} · {task.defect.location}
          </Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Priority</Text>
          <Text style={styles.fieldValue}>{task.priority.charAt(0) + task.priority.slice(1).toLowerCase()}</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Due date</Text>
          <Text style={styles.fieldValue}>{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'Not set'}</Text>
        </View>

        <View style={styles.activitySection}>
          <View style={styles.activityHeader}>
            <Text style={styles.activityTitle}>ACTIVITY</Text>
            <Text style={styles.activityCount}>{updates.length}</Text>
          </View>

          {updates.length === 0 ? (
            <View style={styles.activityEmpty}>
              <Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.textMuted} />
              <Text style={styles.activityEmptyText}>No updates yet — be the first to report in.</Text>
            </View>
          ) : (
            updates.map((u) => (
              <View key={u.id} style={styles.updateCard}>
                <View style={styles.updateTop}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials(u.author.name ?? u.author.email)}</Text>
                  </View>
                  <View style={styles.updateMeta}>
                    <Text style={styles.updateAuthor}>{u.author.name ?? u.author.email}</Text>
                    <Text style={styles.updateTime}>{formatUpdateTime(u.createdAt)}</Text>
                  </View>
                  {u.statusChanged && (
                    <View style={[styles.updateStatusPill, { backgroundColor: TASK_STATUS_STYLE[u.statusAfter].bg }]}>
                      <Text style={[styles.updateStatusText, { color: TASK_STATUS_STYLE[u.statusAfter].color }]}>
                        → {formatTaskStatus(u.statusAfter)}
                      </Text>
                    </View>
                  )}
                </View>
                {!!u.comment && <Text style={styles.updateComment}>{u.comment}</Text>}
                {u.photoUrls.length > 0 && (
                  <View style={styles.updatePhotoRow}>
                    {u.photoUrls.map((url) => (
                      <Image key={url} source={{ uri: url }} style={styles.updatePhotoThumb} />
                    ))}
                  </View>
                )}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Button label="Add Update" leftIcon="add-circle-outline" onPress={() => setUpdateSheetOpen(true)} />
      </SafeAreaView>

      <PickerSheet visible={updateSheetOpen} title="Add Update" onClose={resetUpdateForm}>
        <View style={styles.updateForm}>
          {postError && <Text style={styles.updateErrorText}>{postError}</Text>}
          <Text style={styles.updateFormLabel}>What did you find on site?</Text>
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="Describe the current condition… (optional if you attach a photo)"
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={4}
            style={styles.updateInput}
          />

          <View>
            <Text style={styles.updateFormLabel}>Photos {photos.length > 0 ? `(${photos.length})` : ''}</Text>
            <View style={styles.photoActions}>
              <Button label="Add" variant="outline" leftIcon="images-outline" style={styles.photoActionBtn} onPress={onAddPhoto} />
              <Button label="Capture" variant="primary" leftIcon="camera-outline" style={styles.photoActionBtn} onPress={onCapturePhoto} />
            </View>
            {photos.length > 0 && (
              <View style={styles.photoPreviewRow}>
                {photos.map((p) => (
                  <View key={p.id} style={styles.photoPreviewWrap}>
                    <Image source={{ uri: p.uri }} style={styles.photoPreview} />
                    <Pressable
                      onPress={() => onRemovePhoto(p.id)}
                      style={styles.photoRemove}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel="Remove photo"
                    >
                      <Ionicons name="close" size={12} color={colors.white} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </View>

          <Checkbox checked={markCompleted} onChange={setMarkCompleted} label="Mark this task as Completed" />
          <Button label={posting ? 'Posting…' : 'Post Update'} disabled={!canPost || posting} onPress={onPostUpdate} style={styles.updateSubmit} />
        </View>
      </PickerSheet>

      <PickerSheet visible={statusSheetOpen} title="Status" onClose={() => setStatusSheetOpen(false)}>
        {ALL_TASK_STATUSES.map((st) => {
          const style = TASK_STATUS_STYLE[st];
          return (
            <Pressable key={st} style={styles.statusOption} onPress={() => onPickStatus(st)}>
              <View style={[styles.statusPill, { backgroundColor: style.bg }]}>
                <Text style={[styles.statusPillText, { color: style.color }]}>{formatTaskStatus(st)}</Text>
              </View>
              {st === task.status && <Ionicons name="checkmark" size={18} color={colors.barBlue} />}
            </Pressable>
          );
        })}
      </PickerSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  missingText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  body: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  field: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  fieldLabel: { ...typography.label, color: colors.textMuted, marginBottom: spacing.sm },
  fieldValue: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  link: { ...typography.body, color: colors.accentBlueFg, fontWeight: '700' },
  statusPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  statusPillText: { fontSize: 12, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  activitySection: { marginTop: spacing.sm },
  activityHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md, marginLeft: spacing.xs },
  activityTitle: { ...typography.sectionTitle, color: colors.textMuted },
  activityCount: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textMuted,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    minWidth: 20,
    textAlign: 'center',
  },
  activityEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  activityEmptyText: { ...typography.bodySm, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.xl },
  updateCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  updateTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  avatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.accentBlue, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 12, fontWeight: '700', color: colors.accentBlueFg },
  updateMeta: { flex: 1 },
  updateAuthor: { ...typography.bodySm, fontWeight: '700', color: colors.textPrimary },
  updateTime: { ...typography.caption, color: colors.textMuted, marginTop: 1 },
  updateStatusPill: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  updateStatusText: { fontSize: 11, fontWeight: '700' },
  updateComment: { ...typography.bodySm, color: colors.textSecondary, lineHeight: 19 },
  updatePhotoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  updatePhotoThumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  updateForm: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
  updateFormLabel: { ...typography.label, color: colors.textSecondary },
  updateErrorText: { ...typography.bodySm, color: colors.danger },
  updateInput: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  updateHint: { ...typography.caption, color: colors.accentBlueFg, marginTop: -spacing.sm },
  updateSubmit: { marginTop: spacing.xs },
  photoActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  photoActionBtn: { flex: 1 },
  photoPreviewRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  photoPreviewWrap: { position: 'relative' },
  photoPreview: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  photoRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
});
