import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { Button } from '../../components/ui';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import {
  getSectionGroupsForProperty,
  InspectionSectionItem,
  templateKeyForSectionId,
} from '../../constants/inspectionSections';
import { AppScreenProps } from '../../navigation/types';
import { useInspectionDraft } from '../../context/InspectionDraftContext';

/**
 * Inspection Sections hub — the landing screen after Setup Step 2.
 *
 * Lists all 13 sections grouped by area with per-section completion and an
 * overall progress bar. Completion is read straight from the draft each time
 * this screen gains focus (not tracked as this component's own state) --
 * `draft.setSection(...)` writes to a ref, which doesn't trigger a re-render
 * on its own, so `useFocusEffect` is what notices "a section screen just
 * completed and popped back here" and prompts a fresh read. This used to be
 * a local `completed` map seeded from a one-shot `completedId` route param,
 * which forgot everything the moment this screen unmounted (e.g. leaving via
 * Home and coming back) and had no way to report more than one id at a time
 * -- both Job Information and Description & Overview relied on exactly that
 * missing second case and so could never show as done.
 */
export function InspectionSectionsScreen({
  navigation,
  route,
}: AppScreenProps<'InspectionSections'>) {
  const draft = useInspectionDraft();
  const { propertyTypeId, inspectionTypeId } = draft.getTop();

  // Bumped on focus purely to force this render to re-read the draft below --
  // its value is never itself read.
  const [, bumpOnFocus] = useState(0);
  useFocusEffect(
    useCallback(() => {
      bumpOnFocus((n) => n + 1);
    }, []),
  );

  const sectionGroups = getSectionGroupsForProperty(propertyTypeId, inspectionTypeId);
  const sections = sectionGroups.flatMap((g) => g.sections);
  const totalSections = sections.length;

  const sectionStatus = (section: InspectionSectionItem): 'complete' | 'partial' | undefined => {
    const status = draft.getSection(templateKeyForSectionId(section.id))?.status;
    return status === 'complete' || status === 'partial' ? status : undefined;
  };
  const isSectionDone = (section: InspectionSectionItem): boolean => sectionStatus(section) === 'complete';

  // Only fully-complete sections count toward "X of 13 completed" -- a
  // partially-filled section (e.g. Paving with some but not all four sides
  // done) shows its own amber indicator on the row instead, but doesn't
  // count as done here.
  const completedCount = sections.filter(isSectionDone).length;
  const partialCount = sections.filter((s) => sectionStatus(s) === 'partial').length;
  const customSections = draft.getAllSections().filter((s) => s.key.startsWith('custom_'));
  const progress = totalSections ? completedCount / totalSections : 0;
  const pct = Math.round(progress * 100);

  const openSection = (section: InspectionSectionItem) => {
    if (section.route === 'ReportSummary') {
      // The summary needs its own copy of the completion map + job setup to
      // render its overview -- built fresh from the draft, same as this
      // screen's own ticks.
      const completedMap = Object.fromEntries(sections.map((s) => [s.id, isSectionDone(s)]));
      navigation.navigate('ReportSummary', { completed: completedMap, data: route.params.data });
      return;
    }
    if (section.route === 'JobInformation') {
      // `push`, not `navigate`: Job Information already sits earlier in the
      // stack from the original SelectInspectionType -> JobInformation ->
      // Step2 -> Sections setup flow, and `navigate` to an already-present
      // route pops back to THAT instance -- silently dropping Step 2 and
      // this Sections screen from the stack in the process, so its own back
      // arrow would then go past the hub instead of returning to it. `push`
      // stacks a fresh instance on top instead, directly above this screen.
      // `fromHub` tells it to return here on Next instead of continuing the
      // linear new-inspection flow into Step 2.
      navigation.push('JobInformation', { selection: route.params.data.selection, fromHub: true });
      return;
    }
    if (section.route === 'InspectionSetupStep2') {
      // Same reasoning as JobInformation above -- push a fresh instance so
      // its own back arrow returns here rather than past this screen.
      navigation.push('InspectionSetupStep2', { data: route.params.data });
      return;
    }
    if (section.route) {
      navigation.navigate(section.route as never);
      return;
    }
    Alert.alert(section.title, 'This section isn’t available yet — coming soon.');
  };

  const onNext = () => {
    const next = sections.find((s) => s.route && !isSectionDone(s));
    if (next) {
      openSection(next);
    } else {
      Alert.alert('Inspection sections', 'No further sections are available yet.');
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <InspectionHeader
        title="Inspection Sections"
        onBack={() => navigation.goBack()}
        actions={[
          {
            icon: 'home-outline',
            accessibilityLabel: 'Home',
            onPress: () => navigation.popToTop(),
          },
        ]}
      />

      {/* Overall progress */}
      <View style={styles.progressCard}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressLabel}>Overall Progress</Text>
          <Text style={styles.progressPct}>{pct}%</Text>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.progressMeta}>
          {completedCount} of {totalSections} sections completed
          {partialCount > 0 ? ` · ${partialCount} partially done` : ''}
        </Text>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {sectionGroups.map((group) => (
          <View key={group.title}>
            <Text style={styles.groupTitle}>{group.title.toUpperCase()}</Text>
            {group.sections.map((section) => {
              const status = sectionStatus(section);
              const isDone = status === 'complete';
              const isPartial = status === 'partial';
              const a11ySuffix = isDone ? ', completed' : isPartial ? ', partially completed' : '';
              return (
                <Pressable
                  key={section.id}
                  onPress={() => openSection(section)}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`${section.title}${a11ySuffix}`}
                >
                  <View style={[styles.circle, isDone && styles.circleDone, isPartial && styles.circlePartial]}>
                    {isDone && <Ionicons name="checkmark" size={14} color={colors.white} />}
                    {isPartial && <View style={styles.partialDot} />}
                  </View>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {section.number}. {section.title}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Pressable>
              );
            })}
          </View>
        ))}

        {/* Inspector-added extras — a pergola, granny flat, spare room found
            on site, anything the fixed 13 sections don't cover. Not counted
            in the "X of 13" total above; each gets its own status dot. */}
        <View>
          <Text style={styles.groupTitle}>ADDITIONAL</Text>
          {customSections.map((s) => (
            <Pressable
              key={s.key}
              onPress={() => navigation.navigate('CustomSection', { sectionKey: s.key, sectionName: s.name })}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              accessibilityRole="button"
              accessibilityLabel={`${s.name}${s.status === 'complete' ? ', completed' : s.status === 'partial' ? ', partially completed' : ''}`}
            >
              <View
                style={[
                  styles.circle,
                  s.status === 'complete' && styles.circleDone,
                  s.status === 'partial' && styles.circlePartial,
                ]}
              >
                {s.status === 'complete' && <Ionicons name="checkmark" size={14} color={colors.white} />}
                {s.status === 'partial' && <View style={styles.partialDot} />}
              </View>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {s.name}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          ))}
          <Pressable
            onPress={() => navigation.navigate('AddCustomSection')}
            style={({ pressed }) => [styles.addRow, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel="Add extra structure or room"
          >
            <Ionicons name="add-circle-outline" size={20} color={colors.barBlue} />
            <Text style={styles.addRowText}>Add extra structure / room</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Sticky footer */}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Button
          label="Next"
          variant="primaryGradient"
          onPress={onNext}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  progressCard: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  progressLabel: { ...typography.bodySm, fontWeight: '700', color: colors.textPrimary },
  progressPct: { ...typography.bodySm, fontWeight: '700', color: colors.textPrimary },
  track: {
    height: 6,
    backgroundColor: colors.progressTrack,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  fill: { height: 6, backgroundColor: colors.progressFill, borderRadius: radius.pill },
  progressMeta: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },

  body: { flex: 1 },
  bodyContent: { paddingBottom: spacing.xxxl },

  groupTitle: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.5,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.surfaceAlt },
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  circleDone: { backgroundColor: colors.success, borderColor: colors.success },
  circlePartial: { backgroundColor: colors.warning, borderColor: colors.warning },
  partialDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.white },

  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  addRowText: { ...typography.bodySm, fontWeight: '600', color: colors.barBlue },
  rowTitle: { ...typography.bodySm, fontWeight: '600', color: colors.barBlue, flex: 1 },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
