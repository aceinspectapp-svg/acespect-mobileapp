import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { Button } from '../../components/ui';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import {
  getSectionGroupsForProperty,
  InspectionSectionItem,
} from '../../constants/inspectionSections';
import { AppScreenProps } from '../../navigation/types';
import { useInspectionDraft } from '../../context/InspectionDraftContext';

/**
 * Inspection Sections hub — the landing screen after Setup Step 2.
 *
 * Lists all 13 sections grouped by area with per-section completion and an
 * overall progress bar. Tapping a section opens its screen (only Driveway is
 * wired today); the rest are placeholders until built. A section reports back
 * as complete via the `completedId` navigation param (see DrivewaySection).
 */
export function InspectionSectionsScreen({
  navigation,
  route,
}: AppScreenProps<'InspectionSections'>) {
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const draft = useInspectionDraft();
  const { propertyTypeId, inspectionTypeId } = draft.getTop();

  const sectionGroups = getSectionGroupsForProperty(propertyTypeId, inspectionTypeId);
  const sections = sectionGroups.flatMap((g) => g.sections);
  const totalSections = sections.length;

  // A finished section navigates back here with its id — fold it into progress.
  const completedId = route.params?.completedId;
  useEffect(() => {
    if (completedId) setCompleted((prev) => ({ ...prev, [completedId]: true }));
  }, [completedId]);

  const completedCount = sections.filter((s) => completed[s.id]).length;
  const progress = totalSections ? completedCount / totalSections : 0;
  const pct = Math.round(progress * 100);

  const openSection = (section: InspectionSectionItem) => {
    if (section.route === 'ReportSummary') {
      // The summary needs the live completion map + job setup to render its overview.
      navigation.navigate('ReportSummary', { completed, data: route.params.data });
      return;
    }
    if (section.route === 'JobInformation') {
      // Re-enter to review/edit what was already captured for this inspection.
      navigation.navigate('JobInformation', { selection: route.params.data.selection });
      return;
    }
    if (section.route === 'InspectionSetupStep2') {
      navigation.navigate('InspectionSetupStep2', { data: route.params.data });
      return;
    }
    if (section.route) {
      navigation.navigate(section.route as never);
      return;
    }
    Alert.alert(section.title, 'This section isn’t available yet — coming soon.');
  };

  const onNext = () => {
    const next = sections.find((s) => s.route && !completed[s.id]);
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
              const isDone = !!completed[section.id];
              return (
                <Pressable
                  key={section.id}
                  onPress={() => openSection(section)}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`${section.title}${isDone ? ', completed' : ''}`}
                >
                  <View style={[styles.circle, isDone && styles.circleDone]}>
                    {isDone && <Ionicons name="checkmark" size={14} color={colors.white} />}
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
  rowTitle: { ...typography.bodySm, fontWeight: '600', color: colors.barBlue, flex: 1 },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
