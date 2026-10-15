import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { AppScreenProps } from '../../navigation/types';
import { useInspectionDraft } from '../../context/InspectionDraftContext';
import { AssignedJob, getAssignedJobs } from '../../services/inspectionApi';
import { INSPECTION_TYPES, PROPERTY_TYPES } from '../../constants/inspectionData';

/**
 * Post-Dilapidation jobs admin has pushed to the signed-in inspector
 * (POST /review/inspections/:id/create-post-dilapidation), not yet picked
 * up. Tapping one seeds the draft with its baseline link + job metadata and
 * jumps straight into Job Information -- inspectionType/propertyType are
 * already known from the assignment, so the usual wizard picker is skipped.
 */
export function AssignedJobsScreen({ navigation }: AppScreenProps<'AssignedJobs'>) {
  const draft = useInspectionDraft();
  const [jobs, setJobs] = useState<AssignedJob[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getAssignedJobs()
      .then(setJobs)
      .catch(() => setError(true));
  }, []);

  function openJob(job: AssignedJob) {
    const inspectionTypeId = INSPECTION_TYPES.find((t) => t.title === job.inspectionType)?.id ?? 'dilapidation';
    const propertyTypeId = PROPERTY_TYPES.find((p) => p.title === job.propertyType)?.id ?? 'residential_house';
    draft.reset();
    draft.setTop({
      assignmentId: job.id,
      baselineInspectionId: job.baseline?.id,
      inspectionTypeId,
      propertyTypeId,
      inspectionType: job.inspectionType,
      propertyType: job.propertyType,
      jobNo: job.jobNo ?? undefined,
      address: job.address ?? undefined,
      suburb: job.suburb ?? undefined,
      client: job.client ?? undefined,
    });
    // Job Information's own field keys differ from DraftTop's -- pre-fill
    // its answers directly so the inspector isn't retyping what admin
    // already had on the baseline job.
    draft.setAnswers('job-info', {
      ...(job.jobNo ? { jobNumber: job.jobNo } : {}),
      ...(job.address ? { inspectionAddress: job.address } : {}),
      ...(job.client ? { clientName: job.client } : {}),
    });
    navigation.navigate('JobInformation', { selection: { inspectionTypeId, propertyTypeId } });
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <InspectionHeader title="Assigned Jobs" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.helper}>
          Post-Dilapidation jobs pushed to you for comparison against a previous report.
        </Text>
        {!jobs && !error && <ActivityIndicator color={colors.accentBlueFg} style={{ marginTop: spacing.xl }} />}
        {error && <Text style={styles.helper}>Couldn't load assigned jobs. Pull down to try again later.</Text>}
        {jobs && jobs.length === 0 && <Text style={styles.helper}>No assigned jobs right now.</Text>}
        {jobs?.map((job) => (
          <Pressable key={job.id} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]} onPress={() => openJob(job)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.jobTitle}>{job.address || job.jobNo || 'Untitled job'}</Text>
              <Text style={styles.jobMeta}>
                {job.propertyType} · {job.client || 'No client set'}
              </Text>
              <Text style={styles.jobMetaMuted}>
                Baseline: {job.baseline?.jobNo || job.baseline?.address || 'previous report'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing.lg, gap: spacing.md },
  helper: { ...typography.bodySm, color: colors.textMuted },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  cardPressed: { backgroundColor: colors.surfaceAlt },
  jobTitle: { ...typography.bodySm, fontWeight: '700', color: colors.textPrimary },
  jobMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  jobMetaMuted: { ...typography.caption, color: colors.accentBlueFg, marginTop: 4 },
});
