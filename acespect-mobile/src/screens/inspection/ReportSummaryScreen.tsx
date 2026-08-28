import React, { useRef, useState } from 'react';
import {
  Alert,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { colors, radius, shadows, spacing, typography } from '../../theme';
import { getSectionGroupsForProperty } from '../../constants/inspectionSections';
import { INSPECTION_TYPES } from '../../constants/inspectionData';
import { AppScreenProps } from '../../navigation/types';
import { useInspectionDraft } from '../../context/InspectionDraftContext';
import { uploadPhoto, submitInspection } from '../../services/inspectionApi';

const PROPERTY_LABELS: Record<string, string> = {
  residential_house: 'Residential House',
  apartment: 'Apartment',
  commercial_properties: 'Commercial Properties',
  public_assets: 'Public Assets',
};

/* ─── Signature pad (touch-draw via PanResponder + SVG) ────────────── */
function SignaturePad({ onChange }: { onChange: (signed: boolean) => void }) {
  const [paths, setPaths] = useState<string[]>([]);
  const currentRef = useRef('');
  const [current, setCurrent] = useState('');

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        const x = locationX.toFixed(1);
        const y = locationY.toFixed(1);
        // Seed with a zero-length line so a tap that never moves still draws a
        // round dot (strokeLinecap) rather than nothing -- otherwise the pad
        // reads as "signed" while looking blank.
        currentRef.current = `M${x},${y} L${x},${y}`;
        setCurrent(currentRef.current);
        onChange(true);
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        currentRef.current += ` L${locationX.toFixed(1)},${locationY.toFixed(1)}`;
        setCurrent(currentRef.current);
      },
      onPanResponderRelease: () => {
        // Read the stroke into a local BEFORE clearing the ref: `setPaths`'s
        // updater runs at render time, so a `() => [...prev, currentRef.current]`
        // closure would read the ref after the line below had already emptied
        // it -- committing an empty path and making the signature vanish the
        // moment the finger lifted.
        const stroke = currentRef.current;
        currentRef.current = '';
        setCurrent('');
        if (stroke) setPaths((prev) => [...prev, stroke]);
      },
    }),
  ).current;

  const clear = () => {
    setPaths([]);
    currentRef.current = '';
    setCurrent('');
    onChange(false);
  };

  const hasSigned = paths.length > 0 || current.length > 0;

  return (
    <View>
      <View style={[styles.sigPad, hasSigned && styles.sigPadSigned]} {...pan.panHandlers}>
        <Svg style={StyleSheet.absoluteFill}>
          {paths.map((d, i) => (
            <Path key={i} d={d} stroke={colors.textPrimary} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {current ? (
            <Path d={current} stroke={colors.textPrimary} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ) : null}
        </Svg>
        {!hasSigned && (
          <View style={styles.sigPlaceholder} pointerEvents="none">
            <Ionicons name="pencil-outline" size={18} color={colors.textMuted} />
            <Text style={styles.sigPlaceholderText}>Sign here</Text>
          </View>
        )}
      </View>
      <Pressable onPress={clear} style={styles.sigClear} hitSlop={6}>
        <Ionicons name="refresh-outline" size={12} color={colors.textMuted} />
        <Text style={styles.sigClearText}>Clear signature</Text>
      </Pressable>
    </View>
  );
}

/* ─── Stat card ────────────────────────────────────────────────────── */
function StatCard({ value, label, color, icon }: { value: string | number; label: string; color: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon} size={15} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/* ─── Screen ───────────────────────────────────────────────────────── */
export function ReportSummaryScreen({ navigation, route }: AppScreenProps<'ReportSummary'>) {
  const { completed, data } = route.params;
  const [confirmed, setConfirmed] = useState<'yes' | 'no' | null>(null);
  const [signed, setSigned] = useState(false);
  const draft = useInspectionDraft();
  const [submitting, setSubmitting] = useState(false);

  const sectionGroups = getSectionGroupsForProperty(
    data.selection.propertyTypeId,
    data.selection.inspectionTypeId,
  );
  const sections = sectionGroups.flatMap((g) => g.sections);
  const totalSections = sections.length;

  const completedCount = sections.filter((s) => completed[s.id]).length;
  const remaining = totalSections - completedCount;
  const pct = totalSections ? Math.round((completedCount / totalSections) * 100) : 0;

  const inspectionTypeLabel =
    INSPECTION_TYPES.find((t) => t.id === data.selection.inspectionTypeId)?.title ?? data.selection.inspectionTypeId;

  const canSubmit = confirmed === 'yes' && signed;

  const onGenerate = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      // Upload every locally-captured photo → map local URI to its public URL.
      const uris = draft.collectPhotoUris();
      const urlByUri = new Map<string, string>();
      for (const uri of uris) urlByUri.set(uri, await uploadPhoto(uri));

      // Build the structured payload from the section draft, then fill top-level
      // job fields + ensure a Job Information section from the job setup data.
      const payload = draft.buildPayload((u) => urlByUri.get(u) ?? u);
      payload.inspectionType = inspectionTypeLabel;
      payload.propertyType =
        PROPERTY_LABELS[data.selection.propertyTypeId] ?? data.selection.propertyTypeId;
      payload.jobNo = data.details.jobNumber;
      payload.address = data.details.inspectionAddress;
      payload.client = data.details.clientName;
      payload.date = data.details.inspectionDate;
      payload.overallProgress = pct;

      if (!payload.sections.some((s) => s.key === 'job-info')) {
        payload.sections.unshift({
          key: 'job-info',
          name: 'Job Information',
          icon: '📋',
          order: 0,
          status: 'complete',
          reportText: `Inspection conducted at ${data.details.inspectionAddress}.`,
          fields: {
            clientName: data.details.clientName,
            jobNo: data.details.jobNumber,
            date: data.details.inspectionDate,
            weather: data.weather,
            inspector: data.details.assignedInspector,
          },
        });
      }

      const res = await submitInspection(payload);
      Alert.alert(
        'Saved to your dashboard',
        `Inspection saved as a draft (ref ${res.inspectionId.slice(0, 8)}…). Review and edit it on your dashboard, then finalize it to send for review.`,
        [
          {
            text: 'OK',
            onPress: () => {
              draft.reset();
              navigation.navigate({ name: 'InspectionSections', params: { completedId: 'report_signoff', data }, merge: true });
            },
          },
        ],
      );
    } catch (err) {
      const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      Alert.alert('Submit failed', e?.response?.data?.error?.message ?? e?.message ?? 'Could not submit. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <LinearGradient colors={[colors.headerGradientFrom, colors.headerGradientTo]} style={styles.header}>
        <SafeAreaView edges={['top']}>
          <View style={styles.headerRow}>
            <Pressable onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={18} color={colors.white} />
            </Pressable>
            <View style={styles.titleWrap}>
              <Text style={styles.title}>Report Summary</Text>
              <Text style={styles.subtitle}>{inspectionTypeLabel} Report</Text>
            </View>
            <Pressable onPress={() => navigation.popToTop()} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Home">
              <Ionicons name="home-outline" size={16} color={colors.white} />
            </Pressable>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
        {/* Stats */}
        <View style={styles.statsRow}>
          <StatCard value={completedCount} label="Completed" color={colors.success} icon="checkmark-circle-outline" />
          <StatCard value={remaining} label="Remaining" color={colors.warning} icon="time-outline" />
          <StatCard value={`${pct}%`} label="Progress" color={colors.barBlue} icon="stats-chart-outline" />
        </View>

        {/* Inspection details */}
        <View style={styles.card}>
          <SectionTitle label="Inspection Details" />
          {[
            { label: 'Property', value: data.details.inspectionAddress },
            { label: 'Inspector', value: data.details.assignedInspector },
            { label: 'Date', value: data.details.inspectionDate },
            { label: 'Inspection Type', value: inspectionTypeLabel },
            { label: 'Reference', value: data.details.jobNumber },
          ].map((r, i, arr) => (
            <View key={r.label} style={[styles.detailRow, i < arr.length - 1 && styles.detailRowBorder]}>
              <Text style={styles.detailLabel}>{r.label}</Text>
              <Text style={styles.detailValue} numberOfLines={2}>{r.value}</Text>
            </View>
          ))}
        </View>

        {/* Section overview (real completion) */}
        <View style={styles.card}>
          <SectionTitle label="Section Overview" />
          <Text style={styles.overviewMeta}>{completedCount} of {totalSections} sections completed</Text>
          {sectionGroups.map((group) => (
            <View key={group.title} style={styles.group}>
              <View style={styles.groupTag}>
                <Text style={styles.groupTagText}>{group.title.toUpperCase()}</Text>
              </View>
              {group.sections.map((section) => {
                const done = !!completed[section.id];
                return (
                  <View key={section.id} style={styles.sectionRow}>
                    <Ionicons
                      name={done ? 'checkmark-circle' : 'ellipse-outline'}
                      size={16}
                      color={done ? colors.success : colors.textMuted}
                    />
                    <Text style={styles.sectionName}>{section.number}. {section.title}</Text>
                    <View style={[styles.statusPill, done ? styles.pillDone : styles.pillPending]}>
                      <Text style={[styles.pillText, done ? styles.pillTextDone : styles.pillTextPending]}>
                        {done ? 'Complete' : 'Pending'}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </View>

        {/* Inspector declaration — Confirm / Decline (no free text) */}
        <View style={styles.card}>
          <SectionTitle label="Inspector Declaration" />
          <Text style={styles.declText}>
            I confirm this report accurately reflects the conditions observed at the property on the date of inspection.
          </Text>
          <View style={styles.row}>
            <Pressable
              onPress={() => setConfirmed('yes')}
              style={[styles.declBtn, confirmed === 'yes' && styles.declBtnYes]}
              accessibilityRole="radio"
              accessibilityState={{ selected: confirmed === 'yes' }}
            >
              <Ionicons name="checkmark-circle" size={16} color={confirmed === 'yes' ? colors.white : colors.success} />
              <Text style={[styles.declBtnText, confirmed === 'yes' && styles.declBtnTextActive]}>I Confirm</Text>
            </Pressable>
            <Pressable
              onPress={() => setConfirmed('no')}
              style={[styles.declBtn, confirmed === 'no' && styles.declBtnNo]}
              accessibilityRole="radio"
              accessibilityState={{ selected: confirmed === 'no' }}
            >
              <Ionicons name="close-circle" size={16} color={confirmed === 'no' ? colors.white : colors.danger} />
              <Text style={[styles.declBtnText, confirmed === 'no' && styles.declBtnTextActive]}>Do Not Confirm</Text>
            </Pressable>
          </View>

          {confirmed === 'no' && (
            <Text style={styles.declWarn}>You must confirm the declaration to submit the report.</Text>
          )}

          <Text style={styles.sigLabel}>Inspector Signature</Text>
          <SignaturePad onChange={setSigned} />
        </View>

        {/* Submit */}
        <Pressable onPress={onGenerate} disabled={!canSubmit} style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}>
          <Ionicons name="document-text-outline" size={18} color={colors.white} />
          <Text style={styles.submitText}>{canSubmit ? 'Save to Dashboard' : 'Confirm & Sign to Continue'}</Text>
        </Pressable>

        <Pressable onPress={() => navigation.goBack()} style={styles.draftBtn}>
          <Text style={styles.draftText}>Save as Draft</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function SectionTitle({ label }: { label: string }) {
  return (
    <View style={styles.sectionTitleRow}>
      <View style={styles.sectionTitleBar} />
      <Text style={styles.sectionTitleText}>{label.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.sm },
  title: { ...typography.h3, color: colors.white, fontSize: 17 },
  subtitle: { ...typography.caption, color: colors.textOnDarkMuted, marginTop: 1 },

  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  /* Stats */
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statCard: { flex: 1, alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: spacing.md, ...shadows.card },
  statIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  statValue: { ...typography.h3, color: colors.textPrimary, fontSize: 18 },
  statLabel: { fontSize: 10, fontWeight: '600', color: colors.textMuted, marginTop: 1 },

  /* Card */
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, ...shadows.card },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  sectionTitleBar: { width: 3, height: 14, borderRadius: 2, backgroundColor: colors.barBlue },
  sectionTitleText: { ...typography.sectionTitle, color: colors.textSecondary, letterSpacing: 0.5 },

  /* Detail rows */
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: spacing.sm, gap: spacing.md },
  detailRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  detailLabel: { ...typography.bodySm, color: colors.textMuted },
  detailValue: { ...typography.bodySm, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'right' },

  /* Section overview */
  overviewMeta: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.md },
  group: { marginBottom: spacing.md },
  groupTag: { alignSelf: 'flex-start', backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2, marginBottom: spacing.xs },
  groupTagText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, color: colors.textSecondary },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  sectionName: { ...typography.bodySm, color: colors.textPrimary, flex: 1 },
  statusPill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  pillDone: { backgroundColor: colors.accentGreen },
  pillPending: { backgroundColor: colors.surfaceAlt },
  pillText: { fontSize: 10, fontWeight: '700' },
  pillTextDone: { color: colors.barGreen },
  pillTextPending: { color: colors.textMuted },

  /* Declaration */
  declText: { ...typography.bodySm, color: colors.textSecondary, lineHeight: 19, marginBottom: spacing.md },
  declBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  declBtnYes: { borderColor: colors.success, backgroundColor: colors.success },
  declBtnNo: { borderColor: colors.danger, backgroundColor: colors.danger },
  declBtnText: { ...typography.bodySm, fontWeight: '700', color: colors.textSecondary },
  declBtnTextActive: { color: colors.white },
  declWarn: { ...typography.caption, color: colors.danger, marginTop: spacing.sm },

  /* Signature */
  sigLabel: { ...typography.label, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.sm },
  sigPad: { height: 140, borderRadius: radius.md, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  sigPadSigned: { borderColor: colors.success },
  sigPlaceholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 2 },
  sigPlaceholderText: { ...typography.caption, color: colors.textMuted },
  sigClear: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: spacing.xs, paddingVertical: 2 },
  sigClearText: { ...typography.caption, color: colors.textMuted },

  /* Submit */
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    ...shadows.card,
  },
  submitBtnDisabled: { backgroundColor: colors.disabledBg },
  submitText: { ...typography.body, fontWeight: '700', color: colors.white },
  draftBtn: {
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  draftText: { ...typography.bodySm, fontWeight: '700', color: colors.textSecondary },
});
