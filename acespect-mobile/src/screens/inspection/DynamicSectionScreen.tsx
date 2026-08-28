import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors, spacing, typography } from '../../theme';
import { Button, ProgressBar } from '../../components/ui';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { SectionCard } from '../../components/inspection/SectionCard';
import { FieldListRenderer, SectionNavRenderer } from '../../components/inspection/fieldRenderers';
import type { AnswerTree, AnswerValue } from '../../components/inspection/fieldRenderers/types';
import { useInspectionDraft } from '../../context/InspectionDraftContext';
import { ActiveTemplate, getActiveTemplate } from '../../services/templateApi';
import { flattenSectionToDraft } from '../../utils/flattenSectionToDraft';
import { InspectionDraftSelection } from '../../types/inspection';
import { INSPECTION_TYPES, PROPERTY_LABELS } from '../../constants/inspectionData';
import { getSectionTitle } from '../../constants/inspectionSections';

export interface DynamicSectionScreenProps {
  sectionKey: string;
  sectionName: string;
  icon: string;
  order: number;
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
  const pinKey = `${inspectionTypeId}:${propertyTypeId}:${sectionKey}`;
  const displayName = getSectionTitle(sectionKey, propertyTypeId, sectionName, inspectionTypeId);

  useEffect(() => {
    if (!inspectionTypeId || !propertyTypeId) return;
    const pinned = draft.getActiveTemplate(pinKey);
    if (pinned) {
      setTemplate(pinned);
      return;
    }
    setLoadError(false);
    getActiveTemplate(inspectionTypeId, propertyTypeId, sectionKey)
      .then((t) => {
        draft.setActiveTemplate(pinKey, t);
        setTemplate(t);
      })
      .catch(() => setLoadError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectionTypeId, propertyTypeId, sectionKey]);

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
    getActiveTemplate(inspectionTypeId, propertyTypeId, sectionKey)
      .then((t) => {
        draft.setActiveTemplate(pinKey, t);
        setTemplate(t);
      })
      .catch(() => setLoadError(true));
  }

  const canComplete = !!template && template.fields.filter((f) => f.required).every((f) => !!answers[f.key]);

  function handleComplete() {
    if (!template) return;
    const { fields, damages, reportText } = flattenSectionToDraft(template.fields, answers);
    draft.setSection({
      key: sectionKey,
      name: displayName,
      icon,
      order,
      status: canComplete ? 'complete' : 'partial',
      reportText,
      fields,
      damages,
    });
    onComplete();
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
        {template && !canComplete && template.fields.some((f) => f.required) && (
          <Text style={styles.footerHint}>You can complete with required fields blank, but they're recommended</Text>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  progressWrap: { backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  helper: { ...typography.caption, color: colors.accentBlueFg, textAlign: 'center', paddingHorizontal: spacing.xl },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  completeBtn: { flex: 1 },
  footerHint: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
});
