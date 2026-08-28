import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { AppTextInput, Button, DateField, ProgressBar, SegmentedToggle } from '../../components/ui';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { SectionCard } from '../../components/inspection/SectionCard';
import { ChoiceTileGrid } from '../../components/inspection/ChoiceTile';
import { StatusRow } from '../../components/inspection/StatusRow';
import { PropertyUse, WeatherId } from '../../types/jobSetup';
import { AppScreenProps } from '../../navigation/types';
import { useSystemStatus } from '../../hooks/useSystemStatus';
import { useInspectionDraft } from '../../context/InspectionDraftContext';
import { ActiveTemplate, getActiveTemplate } from '../../services/templateApi';
import { INSPECTION_TYPES, PROPERTY_LABELS } from '../../constants/inspectionData';

const SECTION_KEY = 'job-info';

export function JobInformationScreen({
  route,
  navigation,
}: AppScreenProps<'JobInformation'>) {
  const { selection } = route.params;
  const draft = useInspectionDraft();
  const systemStatus = useSystemStatus();

  const [template, setTemplate] = useState<ActiveTemplate | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Generic answers keyed by field.key — replaces the old fixed `details` shape
  // so the form renders whatever fields the admin's template defines.
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const pinKey = `${selection.inspectionTypeId}:${selection.propertyTypeId}:${SECTION_KEY}`;

  useEffect(() => {
    // Job Information is first in the flow -- pin the raw ids onto the draft
    // so every later section can address templates without re-threading
    // navigation params.
    const typeDef = INSPECTION_TYPES.find((t) => t.id === selection.inspectionTypeId);
    draft.setTop({
      inspectionTypeId: selection.inspectionTypeId,
      propertyTypeId: selection.propertyTypeId,
      inspectionType: typeDef?.title ?? selection.inspectionTypeId,
      propertyType: PROPERTY_LABELS[selection.propertyTypeId] ?? selection.propertyTypeId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Reuse whatever this draft already pinned rather than refetching, so an
    // inspection already in progress keeps the template version it started
    // with even if admin publishes a newer one mid-session.
    const pinned = draft.getActiveTemplate(pinKey);
    if (pinned) {
      setTemplate(pinned);
      return;
    }
    setLoadError(false);
    getActiveTemplate(selection.inspectionTypeId, selection.propertyTypeId, SECTION_KEY)
      .then((t) => {
        draft.setActiveTemplate(pinKey, t);
        setTemplate(t);
      })
      .catch(() => setLoadError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every field starts blank for the inspector to fill in -- except dates,
  // which default to today, since an inspection is all but always dated the
  // day it's carried out. The calendar stays available to change it.
  // (This used to seed from a MOCK_JOB_DETAILS sample job, which put a fake
  // inspector, client and address into every real inspection.)
  useEffect(() => {
    if (!template) return;
    const d = new Date();
    const todayIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setAnswers((prev) => {
      const next = { ...prev };
      for (const f of template.fields) {
        if (next[f.key] === undefined) next[f.key] = f.type === 'date' ? todayIso : '';
      }
      return next;
    });
  }, [template]);

  const setAnswer = (key: string) => (value: string) => setAnswers((a) => ({ ...a, [key]: value }));

  const textFields = (template?.fields ?? [])
    .filter((f) => f.type === 'text' || f.type === 'date')
    .sort((a, b) => a.order - b.order);
  const tileFields = (template?.fields ?? [])
    .filter((f) => f.type === 'select-tiles')
    .sort((a, b) => a.order - b.order);
  const yesNoFields = (template?.fields ?? [])
    .filter((f) => f.type === 'yesno')
    .sort((a, b) => a.order - b.order);

  const canContinue =
    !!template && template.fields.filter((f) => f.required).every((f) => !!answers[f.key]);

  const onNext = () => {
    if (!template || !canContinue) return;
    navigation.navigate('InspectionSetupStep2', {
      data: {
        selection,
        details: {
          jobNumber: answers.jobNumber ?? '',
          inspectionDate: answers.inspectionDate ?? '',
          clientName: answers.clientName ?? '',
          inspectionAddress: answers.inspectionAddress ?? '',
          assignedInspector: answers.assignedInspector ?? '',
          gpsConfirmed: !!answers.inspectionAddress?.trim(),
        },
        weather: (answers.weather ?? '') as WeatherId,
        usedAsBusiness: (answers.usedAsBusiness ?? '') as PropertyUse,
        systemStatus: systemStatus.snapshot,
      },
    });
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <InspectionHeader
        title="Job Information"
        subtitle="Inspection Setup · Step 1 of 2"
        onBack={() => navigation.goBack()}
        actions={[
          {
            icon: 'save-outline',
            accessibilityLabel: 'Save draft',
            onPress: () => Alert.alert('Draft saved', 'Job setup saved locally.'),
          },
          {
            icon: 'home-outline',
            accessibilityLabel: 'Home',
            onPress: () => navigation.popToTop(),
          },
        ]}
      />

      <View style={styles.progressWrap}>
        <ProgressBar progress={0.5} />
      </View>

      {!template ? (
        <View style={styles.loadingWrap}>
          {loadError ? (
            <>
              <Text style={styles.helper}>Couldn't load the job information form.</Text>
              <Button
                label="Retry"
                variant="outline"
                onPress={() => {
                  setLoadError(false);
                  getActiveTemplate(selection.inspectionTypeId, selection.propertyTypeId, SECTION_KEY)
                    .then((t) => {
                      draft.setActiveTemplate(pinKey, t);
                      setTemplate(t);
                    })
                    .catch(() => setLoadError(true));
                }}
              />
            </>
          ) : (
            <ActivityIndicator color={colors.accentBlueFg} />
          )}
        </View>
      ) : (
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Info banner */}
          <View style={styles.banner}>
            <Ionicons name="information-circle" size={18} color={colors.infoFg} />
            <Text style={styles.bannerText}>
              Enter and confirm all job details before beginning the inspection.
            </Text>
          </View>

          {/* JOB DETAILS — text/date fields from the template */}
          {textFields.length > 0 && (
            <SectionCard title="JOB DETAILS" accent="blue">
              {textFields.map((field, idx) => (
                <React.Fragment key={field.key}>
                  {idx > 0 && <Spacer />}
                  {field.type === 'date' ? (
                    <DateField
                      label={field.label}
                      required={field.required}
                      readOnly={field.readOnly}
                      value={answers[field.key] ?? ''}
                      onChange={setAnswer(field.key)}
                    />
                  ) : (
                    <AppTextInput
                      label={field.label}
                      required={field.required}
                      readOnly={field.readOnly}
                      value={answers[field.key] ?? ''}
                      onChangeText={setAnswer(field.key)}
                    />
                  )}
                </React.Fragment>
              ))}
              {/* Only meaningful once an address has actually been entered. */}
              {!!answers.inspectionAddress?.trim() && (
                <View style={styles.gpsNote}>
                  <Ionicons name="location" size={14} color={colors.barGreen} />
                  <Text style={styles.gpsText}>
                    <Text style={styles.gpsBold}>Confirmed: </Text>
                    {answers.inspectionAddress ?? ''} · GPS locked
                  </Text>
                </View>
              )}
            </SectionCard>
          )}

          {/* Single-select tile fields (e.g. weather). The card title already
              states the question -- repeating it as a field label underneath
              just read as the same question asked twice. */}
          {tileFields.map((field) => (
            <SectionCard
              key={field.key}
              title={`${field.label.toUpperCase()}${field.required ? ' *' : ''}`}
              accent="orange"
            >
              <ChoiceTileGrid
                options={(field.options ?? []).map((o) => ({
                  value: o.value,
                  label: o.label,
                  icon: (o.icon ?? 'help-circle-outline') as React.ComponentProps<typeof ChoiceTileGrid>['options'][number]['icon'],
                }))}
                value={answers[field.key] ?? null}
                onChange={setAnswer(field.key)}
                columns={3}
              />
            </SectionCard>
          ))}

          {/* Yes/No fields (e.g. used as business) */}
          {yesNoFields.map((field) => (
            <SectionCard
              key={field.key}
              title={`${field.label.toUpperCase()}${field.required ? ' *' : ''}`}
              accent="purple"
            >
              <SegmentedToggle
                options={(field.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
                value={answers[field.key] ?? null}
                onChange={setAnswer(field.key)}
              />
            </SectionCard>
          ))}

          {/* SYSTEM STATUS — not part of the template, always device/system telemetry */}
          <SectionCard title="SYSTEM STATUS" accent="green">
            <Text style={[styles.helper, styles.statusHelper]}>
              The following are automatically initialised when the inspection begins.
            </Text>
            <StatusRow
              icon="time-outline"
              label="Inspection Started"
              value={systemStatus.startedAt.value}
              done={systemStatus.startedAt.ready}
            />
            <StatusRow
              icon="location-outline"
              label="GPS Location"
              value={systemStatus.gpsLocation.value}
              done={systemStatus.gpsLocation.ready}
            />
            <StatusRow
              icon="camera-outline"
              label="Photo Sequence"
              value={systemStatus.photoSequence.value}
              done={systemStatus.photoSequence.ready}
            />
            <StatusRow
              icon="wifi-outline"
              label="Cloud Sync"
              value={systemStatus.cloudSync.value}
              done={systemStatus.cloudSync.ready}
            />
            <StatusRow
              icon="save-outline"
              label="Offline Save"
              value={systemStatus.offlineSave.value}
              done={systemStatus.offlineSave.ready}
            />
          </SectionCard>
        </ScrollView>
      )}

      {/* Sticky footer */}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <View style={styles.footerRow}>
          <Button
            label="Back"
            variant="outline"
            leftIcon="chevron-back"
            fitContent
            onPress={() => navigation.goBack()}
          />
          <Button
            label="Next"
            variant="primaryGradient"
            rightIcon="chevron-forward"
            disabled={!canContinue}
            onPress={onNext}
            style={styles.nextBtn}
          />
        </View>
        {template && !canContinue && (
          <Text style={styles.footerHint}>
            Fill in all required fields to continue
          </Text>
        )}
      </SafeAreaView>
    </View>
  );
}

function Spacer() {
  return <View style={{ height: spacing.lg }} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  progressWrap: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  banner: {
    flexDirection: 'row',
    backgroundColor: colors.infoBg,
    borderWidth: 1,
    borderColor: colors.infoBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bannerText: {
    ...typography.bodySm,
    color: colors.infoFg,
    flex: 1,
    marginLeft: spacing.sm,
    lineHeight: 18,
  },
  fieldLabel: { ...typography.label, color: colors.textSecondary },
  req: { color: colors.danger, fontWeight: '700' },
  helper: {
    ...typography.caption,
    color: colors.accentBlueFg,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    lineHeight: 16,
  },
  statusHelper: { color: colors.accentOrangeFg },
  gpsNote: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  gpsText: { ...typography.caption, color: colors.textSecondary, flex: 1, marginLeft: spacing.sm },
  gpsBold: { fontWeight: '700', color: colors.textPrimary },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  nextBtn: { flex: 1 },
  footerHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
