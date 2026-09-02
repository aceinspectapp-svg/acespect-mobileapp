import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors, radius, spacing, typography } from '../../theme';
import { Button, ProgressBar } from '../../components/ui';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { SectionCard } from '../../components/inspection/SectionCard';
import { FieldListRenderer, SectionNavRenderer } from '../../components/inspection/fieldRenderers';
import type { AnswerTree, AnswerValue } from '../../components/inspection/fieldRenderers/types';
import { useInspectionDraft, BaselineSectionRef } from '../../context/InspectionDraftContext';
import { ActiveTemplate, getActiveTemplate, TemplateField } from '../../services/templateApi';
import { flattenSectionToDraft, meetsAllRequireWhen, meetsAllRequiredFields } from '../../utils/flattenSectionToDraft';
import { InspectionDraftSelection } from '../../types/inspection';
import { INSPECTION_TYPES, PROPERTY_LABELS } from '../../constants/inspectionData';
import { getSectionTitle } from '../../constants/inspectionSections';
import { getBaselineSections as fetchBaselineSections } from '../../services/inspectionApi';

/**
 * Every Post-Dilapidation job asks the same opinion of every section, on top
 * of whatever that section's own template already asks: has anything
 * changed since the baseline was recorded? Built here rather than stored on
 * the template, since it's the same three fields for every section
 * regardless of inspectionType/propertyType.
 */
const COMPARISON_FIELDS: TemplateField[] = [
  {
    key: 'comparisonResult', type: 'pill-select', label: 'Compared to the previous inspection', order: 0, required: true,
    options: [
      { value: 'no_change', label: 'No visibly significant change' },
      { value: 'changes', label: 'There are changes' },
    ],
  },
  {
    key: 'comparisonExplanation', type: 'textarea', label: 'What has changed?', order: 1, required: true,
    gate: { fieldKey: 'comparisonResult', equals: 'changes' },
  },
  {
    key: 'comparisonPhotos', type: 'photos', label: 'Photographic evidence of the change', order: 2, required: true,
    gate: { fieldKey: 'comparisonResult', equals: 'changes' },
  },
];

export interface DynamicSectionScreenProps {
  sectionKey: string;
  sectionName: string;
  icon: string;
  order: number;
  /**
   * Which template to fetch/render, if different from `sectionKey` itself --
   * every inspector-added custom section ("Add extra structure") gets its
   * own unique `sectionKey` for draft persistence, but they all render and
   * fetch the one shared `custom_structure` template. Defaults to
   * `sectionKey`, matching every fixed section screen.
   */
  templateKey?: string;
  onBack: () => void;
  onComplete: () => void;
  onGoHome: () => void;
  /** Only the very first section in the flow (Job Information) receives the
   *  wizard's fresh selection -- it pins inspectionTypeId/propertyTypeId
   *  onto the draft so every later section can read it back. */
  selection?: InspectionDraftSelection;
}

/**
 * Generic section screen driven entirely by an admin-published template.
 * Replaces the hardcoded per-section screens: fetches (and pins, for the
 * lifetime of this draft) the active template for
 * (inspectionType, propertyType, sectionKey), renders its fields via
 * FieldListRenderer, and flattens the answers back into the exact
 * DraftSection shape the submit payload already expects.
 */
export function DynamicSectionScreen({
  sectionKey,
  sectionName,
  icon,
  order,
  templateKey = sectionKey,
  onBack,
  onComplete,
  onGoHome,
  selection,
}: DynamicSectionScreenProps) {
  const draft = useInspectionDraft();
  const [template, setTemplate] = useState<ActiveTemplate | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Restore whatever was already filled in for this section -- a fresh {}
  // here is what made revisiting a section (hub -> section -> hub -> same
  // section again, which remounts this screen) show a blank form even
  // though the answers were already captured.
  const [answers, setAnswers] = useState<AnswerTree>(() => draft.getAnswers(sectionKey) ?? {});

  // Post-Dilapidation: this job is being assessed against an earlier
  // inspection. `undefined` = not checked yet, `null` = checked, no entry
  // for this section (a normal job, or a section the baseline never had).
  const isPostDilapidation = !!draft.getTop().baselineInspectionId;
  const [baselineSection, setBaselineSection] = useState<BaselineSectionRef | null | undefined>(undefined);
  useEffect(() => {
    if (!isPostDilapidation || !draft.getTop().assignmentId) {
      setBaselineSection(null);
      return;
    }
    const cached = draft.getBaselineSections();
    if (cached) {
      setBaselineSection(cached.find((s) => s.key === sectionKey) ?? null);
      return;
    }
    fetchBaselineSections(draft.getTop().assignmentId as string)
      .then((sections) => {
        draft.setBaselineSections(sections);
        setBaselineSection(sections.find((s) => s.key === sectionKey) ?? null);
      })
      .catch(() => setBaselineSection(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionKey, isPostDilapidation]);

  // Job Information is first in the flow and owns the wizard's fresh
  // selection -- pin the raw ids onto the draft so every later section can
  // address templates without re-threading navigation params.
  useEffect(() => {
    if (!selection) return;
    const typeDef = INSPECTION_TYPES.find((t) => t.id === selection.inspectionTypeId);
    draft.setTop({
      inspectionTypeId: selection.inspectionTypeId,
      propertyTypeId: selection.propertyTypeId,
      inspectionType: typeDef?.title ?? selection.inspectionTypeId,
      propertyType: PROPERTY_LABELS[selection.propertyTypeId] ?? selection.propertyTypeId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { inspectionTypeId, propertyTypeId } = draft.getTop();
  const pinKey = `${inspectionTypeId}:${propertyTypeId}:${templateKey}`;
  const displayName = getSectionTitle(sectionKey, propertyTypeId, sectionName, inspectionTypeId);

  useEffect(() => {
    if (!inspectionTypeId || !propertyTypeId) return;
    const pinned = draft.getActiveTemplate(pinKey);
    if (pinned) {
      setTemplate(pinned);
      return;
    }
    setLoadError(false);
    getActiveTemplate(inspectionTypeId, propertyTypeId, templateKey)
      .then((t) => {
        draft.setActiveTemplate(pinKey, t);
        setTemplate(t);
      })
      .catch(() => setLoadError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectionTypeId, propertyTypeId, templateKey]);

  function setAnswer(key: string, value: AnswerValue) {
    setAnswers((prev) => {
      const next = { ...prev, [key]: value };
      draft.setAnswers(sectionKey, next);
      return next;
    });
  }

  function retry() {
    if (!inspectionTypeId || !propertyTypeId) return;
    setLoadError(false);
    getActiveTemplate(inspectionTypeId, propertyTypeId, templateKey)
      .then((t) => {
        draft.setActiveTemplate(pinKey, t);
        setTemplate(t);
      })
      .catch(() => setLoadError(true));
  }

  // Comparison fields fold into the same completion/save checks as the
  // section's own template fields -- they live in the same `answers` tree,
  // just under their own keys, so this is a plain concat rather than a
  // second parallel completion mechanism.
  const allFields = useMemo(
    () => (isPostDilapidation ? [...(template?.fields ?? []), ...COMPARISON_FIELDS] : template?.fields ?? []),
    [template, isPostDilapidation],
  );

  const canComplete =
    !!template &&
    meetsAllRequiredFields(allFields, answers) &&
    meetsAllRequireWhen(allFields, answers);

  function saveSection(status: 'complete' | 'partial') {
    if (!template) return;
    const { fields, damages, reportText } = flattenSectionToDraft(allFields, answers);
    draft.setSection({
      key: sectionKey,
      name: displayName,
      icon,
      order,
      status,
      reportText,
      fields,
      damages,
    });
    onComplete();
  }

  function handleComplete() {
    if (!template) return;
    if (canComplete) {
      saveSection('complete');
      return;
    }
    // Explicit prompt rather than silently saving as partial and moving on
    // -- e.g. Paving has four sides and it's easy to complete the first one,
    // hit Next, and not notice the other three were skipped.
    Alert.alert(
      'Section incomplete',
      "Not everything here has been filled in yet, so this will be saved as partially done rather than complete. You can come back and finish it later.",
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Save as partial', onPress: () => saveSection('partial') },
      ],
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <InspectionHeader
        title={displayName}
        subtitle={icon}
        onBack={onBack}
        actions={[
          { icon: 'save-outline', accessibilityLabel: 'Save draft', onPress: () => Alert.alert('Draft saved', `${displayName} saved locally.`) },
          { icon: 'home-outline', accessibilityLabel: 'Home', onPress: onGoHome },
        ]}
      />
      <View style={styles.progressWrap}>
        <ProgressBar progress={0.6} />
      </View>

      {!template ? (
        <View style={styles.loadingWrap}>
          {loadError ? (
            <>
              <Text style={styles.helper}>Couldn't load this section's form.</Text>
              <Button label="Retry" variant="outline" onPress={retry} />
            </>
          ) : (
            <ActivityIndicator color={colors.accentBlueFg} />
          )}
        </View>
      ) : (
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
          {isPostDilapidation && baselineSection && (
            <View style={styles.baselineCard}>
              <Text style={styles.baselineLabel}>PREVIOUSLY RECORDED</Text>
              <Text style={styles.baselineText}>
                {baselineSection.reportText || 'No summary was recorded for this section.'}
              </Text>
              {baselineSection.photos.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.baselinePhotos}>
                  {baselineSection.photos.map((uri) => (
                    <Image key={uri} source={{ uri }} style={styles.baselinePhoto} />
                  ))}
                </ScrollView>
              )}
            </View>
          )}
          {isPostDilapidation && baselineSection === null && (
            <View style={styles.baselineCard}>
              <Text style={styles.baselineText}>
                The previous inspection didn't record this section — give your own assessment below.
              </Text>
            </View>
          )}

          <SectionCard title={displayName.toUpperCase()} accent="blue">
            {template.layout?.mode === 'section-nav' ? (
              <SectionNavRenderer
                fields={template.fields}
                layout={template.layout}
                scope={answers}
                onChange={setAnswer}
                path={[sectionKey]}
              />
            ) : (
              <FieldListRenderer
                fields={template.fields}
                scope={answers}
                onChange={setAnswer}
                path={[sectionKey]}
              />
            )}
          </SectionCard>

          {isPostDilapidation && (
            <SectionCard title="COMPARED TO PREVIOUS INSPECTION" accent="blue">
              <FieldListRenderer
                fields={COMPARISON_FIELDS}
                scope={answers}
                onChange={setAnswer}
                path={[sectionKey, 'comparison']}
              />
            </SectionCard>
          )}
        </ScrollView>
      )}

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <View style={styles.footerRow}>
          <Button label="Back" variant="outline" leftIcon="chevron-back" fitContent onPress={onBack} />
          <Button
            label="Complete Section"
            variant="primaryGradient"
            rightIcon="checkmark"
            disabled={!template}
            onPress={handleComplete}
            style={styles.completeBtn}
          />
        </View>
        {template && !canComplete && (
          <Text style={styles.footerHint}>
            You can complete with required fields blank, but they're recommended
          </Text>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  progressWrap: { backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  baselineCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  baselineLabel: { ...typography.caption, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5, marginBottom: spacing.xs },
  baselineText: { ...typography.bodySm, color: colors.textPrimary },
  baselinePhotos: { marginTop: spacing.sm },
  baselinePhoto: { width: 72, height: 72, borderRadius: radius.md, marginRight: spacing.sm, backgroundColor: colors.border },
  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  helper: { ...typography.caption, color: colors.accentBlueFg, textAlign: 'center', paddingHorizontal: spacing.xl },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  completeBtn: { flex: 1 },
  footerHint: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
});
