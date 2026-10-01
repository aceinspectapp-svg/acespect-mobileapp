import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { FieldLabel, PlainTextInput } from '../../components/inspection/fieldKit';
import { DateField } from '../../components/ui';
import { PickerSheet } from '../../components/qc/PickerSheet';
import { SeverityPill } from '../../components/qc/SeverityPill';
import { StatusBadge } from '../../components/qc/StatusBadge';
import { AppScreenProps } from '../../navigation/types';
import { useQcData } from '../../context/QcDataContext';
import { QcDefect, QcSeverity, QcStatus } from '../../types/qc';

/**
 * Editable by whoever it's assigned to -- the admin now only picks the
 * client/project/property and assigns a person (acespect-web's QC section);
 * location/location details/summary/severity/status/due date are
 * deliberately left for the field user to fill in on-site, here. Status is a
 * free pick across the whole lifecycle, same as the Severity picker below --
 * reassigning is the one thing that stays admin-only, so there's no
 * "assigned to" picker on this screen.
 */
export function QcDefectDetailScreen({ navigation, route }: AppScreenProps<'QcDefectDetail'>) {
  const { defectId } = route.params;
  const { getDefect, updateDefect, getSeverities, getStatuses } = useQcData();
  const [defect, setDefect] = useState<QcDefect | null>(null);
  const [severities, setSeverities] = useState<QcSeverity[]>([]);
  const [statuses, setStatuses] = useState<QcStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [severitySheetOpen, setSeveritySheetOpen] = useState(false);
  const [statusSheetOpen, setStatusSheetOpen] = useState(false);

  // Local draft -- only sent to the server on Save, so navigating away
  // without saving never half-applies an edit.
  const [location, setLocation] = useState('');
  const [locationDetails, setLocationDetails] = useState('');
  const [summary, setSummary] = useState('');
  const [severityId, setSeverityId] = useState<string | null>(null);
  const [statusId, setStatusId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState(''); // YYYY-MM-DD, DateField's own format

  useEffect(() => {
    getDefect(defectId)
      .then((d) => {
        setDefect(d);
        setLocation(d.location ?? '');
        setLocationDetails(d.locationDetails ?? '');
        setSummary(d.summary ?? '');
        setSeverityId(d.severity?.id ?? null);
        setStatusId(d.status.id);
        setDueDate(d.dueDate ? d.dueDate.slice(0, 10) : '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load defect'));
    getSeverities()
      .then(setSeverities)
      .catch(() => {}); // non-fatal -- the picker just shows nothing to choose if this fails
    getStatuses()
      .then(setStatuses)
      .catch(() => {});
  }, [defectId, getDefect, getSeverities, getStatuses]);

  const dirty =
    !!defect &&
    (location !== (defect.location ?? '') ||
      locationDetails !== (defect.locationDetails ?? '') ||
      summary !== (defect.summary ?? '') ||
      severityId !== (defect.severity?.id ?? null) ||
      statusId !== defect.status.id ||
      dueDate !== (defect.dueDate ? defect.dueDate.slice(0, 10) : ''));

  async function save() {
    if (!defect || saving) return;
    setSaving(true);
    try {
      const updated = await updateDefect(defect.id, {
        location: location.trim() || undefined,
        locationDetails: locationDetails.trim(),
        summary: summary.trim() || undefined,
        severityId: severityId ?? undefined,
        statusId: statusId ?? undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      });
      setDefect(updated);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const selectedSeverity = severities.find((s) => s.id === severityId) ?? null;
  const selectedStatus = statuses.find((s) => s.id === statusId) ?? defect?.status ?? null;

  return (
    <View style={styles.root}>
      <InspectionHeader
        title={defect?.summary || 'Defect'}
        subtitle={defect?.property.name}
        onBack={() => navigation.goBack()}
        actions={
          dirty
            ? [{ icon: 'checkmark-circle', accessibilityLabel: 'Save', onPress: () => void save() }]
            : []
        }
      />

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
            <Text style={styles.fieldLabel}>Property</Text>
            <Text style={styles.fieldValue}>
              {defect.client.name} › {defect.project.name} › {defect.property.name}
            </Text>
          </View>

          <View style={styles.field}>
            <FieldLabel required>Location</FieldLabel>
            <PlainTextInput value={location} onChangeText={setLocation} placeholder="e.g. Kitchen / Dining, Balcony…" />
          </View>

          <View style={styles.field}>
            <FieldLabel>Location details (optional)</FieldLabel>
            <PlainTextInput value={locationDetails} onChangeText={setLocationDetails} placeholder="e.g. north-facing wall, bottom hinge" />
          </View>

          <View style={styles.field}>
            <FieldLabel required>Summary</FieldLabel>
            <PlainTextInput value={summary} onChangeText={setSummary} placeholder="Describe the defect…" multiline />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Severity</Text>
            <Pressable style={styles.severityRow} onPress={() => setSeveritySheetOpen(true)}>
              <SeverityPill severity={selectedSeverity} />
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          </View>

          <View style={styles.field}>
            <DateField label="Due date (optional)" value={dueDate} onChange={setDueDate} placeholder="Select a date" />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Status</Text>
            <Pressable style={styles.severityRow} onPress={() => setStatusSheetOpen(true)}>
              {selectedStatus && <StatusBadge status={selectedStatus} />}
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Logged by</Text>
            <Text style={styles.fieldValue}>{defect.createdBy.name ?? defect.createdBy.email}</Text>
          </View>
        </ScrollView>
      )}

      <PickerSheet visible={severitySheetOpen} title="Severity" onClose={() => setSeveritySheetOpen(false)}>
        {severities.map((s) => (
          <Pressable
            key={s.id}
            style={styles.severityOption}
            onPress={() => {
              setSeverityId(s.id);
              setSeveritySheetOpen(false);
            }}
          >
            <SeverityPill severity={s} />
            {s.id === severityId && <Ionicons name="checkmark" size={18} color={colors.barBlue} />}
          </Pressable>
        ))}
      </PickerSheet>

      <PickerSheet visible={statusSheetOpen} title="Status" onClose={() => setStatusSheetOpen(false)}>
        {statuses.map((s) => (
          <Pressable
            key={s.id}
            style={styles.statusOption}
            onPress={() => {
              setStatusId(s.id);
              setStatusSheetOpen(false);
            }}
          >
            <View style={styles.statusOptionText}>
              <StatusBadge status={s} />
              <Text style={styles.statusMeaning}>{s.meaning}</Text>
            </View>
            {s.id === statusId && <Ionicons name="checkmark" size={18} color={colors.barBlue} />}
          </Pressable>
        ))}
      </PickerSheet>
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
  severityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  severityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  statusOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  statusOptionText: { flex: 1, gap: spacing.xs, alignItems: 'flex-start' },
  statusMeaning: { ...typography.caption, color: colors.textMuted },
});
