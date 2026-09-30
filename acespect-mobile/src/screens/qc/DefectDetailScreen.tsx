import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { SeverityPill } from '../../components/qc/SeverityPill';
import { StatusBadge } from '../../components/qc/StatusBadge';
import { AppScreenProps } from '../../navigation/types';
import { useQcData } from '../../context/QcDataContext';
import { QcDefect } from '../../types/qc';

/**
 * Read-only — editing/reassigning/reclassifying a defect is an admin
 * operation now (acespect-web's QC section). This screen exists purely so
 * the "Defect" link on Task Detail has somewhere useful to go.
 */
export function QcDefectDetailScreen({ navigation, route }: AppScreenProps<'QcDefectDetail'>) {
  const { defectId } = route.params;
  const { getDefect } = useQcData();
  const [defect, setDefect] = useState<QcDefect | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDefect(defectId)
      .then(setDefect)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load defect'));
  }, [defectId, getDefect]);

  return (
    <View style={styles.root}>
      <InspectionHeader title={defect?.summary ?? 'Defect'} subtitle={defect?.property.name} onBack={() => navigation.goBack()} />

      {!defect && !error && (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentBlueFg} />
        </View>
      )}
      {error && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {defect && (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Status</Text>
            <StatusBadge status={defect.status} />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Location</Text>
            <Text style={styles.fieldValue}>
              {defect.client.name} › {defect.project.name} › {defect.property.name} › {defect.location}
            </Text>
            {!!defect.locationDetails && <Text style={styles.fieldSub}>{defect.locationDetails}</Text>}
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Description</Text>
            <Text style={styles.fieldValue}>{defect.summary}</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Severity</Text>
            <SeverityPill severity={defect.severity} />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Assigned to</Text>
            <Text style={styles.fieldValue}>{defect.assignedTo?.name ?? defect.assignedTo?.email ?? 'Unassigned'}</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Due date</Text>
            <Text style={styles.fieldValue}>{defect.dueDate ? new Date(defect.dueDate).toLocaleDateString() : 'Not set'}</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Logged by</Text>
            <Text style={styles.fieldValue}>{defect.createdBy.name ?? defect.createdBy.email}</Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  errorText: { ...typography.body, color: colors.danger, textAlign: 'center' },
  body: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },
  field: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  fieldLabel: { ...typography.label, color: colors.textMuted, marginBottom: spacing.sm },
  fieldValue: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  fieldSub: { ...typography.caption, color: colors.textMuted, marginTop: 4 },
});
