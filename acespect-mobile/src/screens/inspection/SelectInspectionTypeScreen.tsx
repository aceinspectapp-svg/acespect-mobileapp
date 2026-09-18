import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';
import { Button, Stepper } from '../../components/ui';
import { InspectionTypeCard } from '../../components/inspection/InspectionTypeCard';
import { PropertyTypeRow } from '../../components/inspection/PropertyTypeRow';
import { ConfirmStartModal } from '../../components/inspection/ConfirmStartModal';
import { INSPECTION_TYPES, PROPERTY_TYPES } from '../../constants/inspectionData';
import { InspectionTypeId, PropertyTypeId } from '../../types/inspection';
import { AppScreenProps } from '../../navigation/types';
import { getAssignedJobs } from '../../services/inspectionApi';
import { useAuth } from '../../context/AuthContext';
import { useInspectionDraft } from '../../context/InspectionDraftContext';
import { loadDraftSnapshot, DraftSnapshot, QueuedSubmission } from '../../services/offlineStorage';
import {
  subscribe as subscribeSyncQueue,
  subscribeProcessing,
  retryNow,
  isWaitingForWifi,
} from '../../services/syncManager';
import { buildJobSetupDataFromDraft } from '../../utils/jobSetupFromDraft';

const STEPS = [
  { label: 'Inspection Type' },
  { label: 'Property Type' },
  { label: 'Begin' },
];

export function SelectInspectionTypeScreen({
  navigation,
}: AppScreenProps<'SelectInspectionType'>) {
  const [typeId, setTypeId] = useState<InspectionTypeId | null>(null);
  const [propertyId, setPropertyId] = useState<PropertyTypeId | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);

  // Post-Dilapidation jobs admin has pushed to this inspector. Failure is
  // silent -- this is a convenience banner, not core to starting a normal
  // inspection, so it just doesn't show rather than blocking the screen.
  const [assignedCount, setAssignedCount] = useState(0);
  useEffect(() => {
    getAssignedJobs()
      .then((jobs) => setAssignedCount(jobs.length))
      .catch(() => {});
  }, []);

  // Pending offline submissions -- inspections finished with no signal,
  // waiting for the sync queue to upload them. See syncManager.ts.
  const [pendingQueue, setPendingQueue] = useState<QueuedSubmission[]>([]);
  useEffect(() => subscribeSyncQueue(setPendingQueue), []);

  // Whether a sync pass is currently running -- a pass can legitimately take
  // a while (each photo upload gets up to 120s, and an entry can hold
  // several), and syncManager silently no-ops a retry while one's already in
  // flight. Without this, tapping the banner mid-pass looks like the tap did
  // nothing at all, which is exactly the confusing part.
  const [syncing, setSyncing] = useState(false);
  useEffect(() => subscribeProcessing(setSyncing), []);

  // Whether it's the Wi-Fi-only preference (not just "no signal at all")
  // holding the queue back, so the banner doesn't claim "tap to retry" is
  // pointless when it isn't -- an explicit tap still syncs over cellular.
  const [waitingForWifi, setWaitingForWifi] = useState(false);
  useFocusEffect(
    useCallback(() => {
      isWaitingForWifi().then(setWaitingForWifi).catch(() => {});
    }, []),
  );

  // A draft left mid-inspection from a killed/crashed app session (not yet
  // submitted or queued) -- offered here rather than silently discarded, so
  // starting a fresh inspection is a deliberate choice, not an accident.
  const draft = useInspectionDraft();
  const [resumableDraft, setResumableDraft] = useState<DraftSnapshot | null>(null);
  useFocusEffect(
    useCallback(() => {
      loadDraftSnapshot().then(setResumableDraft).catch(() => {});
    }, []),
  );

  const onResumeDraft = () => {
    if (!resumableDraft) return;
    draft.hydrateFromSnapshot(resumableDraft);
    const data = buildJobSetupDataFromDraft(resumableDraft.top, resumableDraft.answers['job-info']);
    navigation.navigate('InspectionSections', { data });
  };

  // Auto-scroll to the Property Type section once an inspection type is picked.
  const scrollRef = useRef<ScrollView>(null);
  const propertyY = useRef(0);

  const selectedType = useMemo(
    () => INSPECTION_TYPES.find((t) => t.id === typeId) ?? null,
    [typeId],
  );

  // Which property types are valid for the chosen inspection type.
  const applicable = useMemo(
    () => new Set(selectedType?.applicableProperties ?? []),
    [selectedType],
  );

  const onSelectType = (id: InspectionTypeId) => {
    setTypeId(id);
    // Drop an incompatible property selection when the type changes.
    setPropertyId((prev) => {
      const next = INSPECTION_TYPES.find((t) => t.id === id);
      return prev && next?.applicableProperties.includes(prev) ? prev : null;
    });
    // Bring the Property Type section into view so the inspector continues
    // without scrolling manually.
    setTimeout(
      () => scrollRef.current?.scrollTo({ y: Math.max(0, propertyY.current - 16), animated: true }),
      180,
    );
  };

  // Stepper position derives from how far the selection has progressed.
  const currentStep = !typeId ? 0 : !propertyId ? 1 : 2;
  const canBegin = !!typeId && !!propertyId;

  // Inspector has acknowledged the pre-start checklist — proceed into setup.
  const onConfirmStart = () => {
    setConfirmVisible(false);
    navigation.navigate('JobInformation', {
      selection: { inspectionTypeId: typeId!, propertyTypeId: propertyId! },
    });
  };

  const { signOut } = useAuth();
  const onSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <LinearGradient
        colors={[colors.headerGradientFrom, colors.headerGradientTo]}
        style={styles.header}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.headerTopRow}>
            <Pressable
              onPress={() => navigation.goBack()}
              style={styles.backBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={20} color={colors.white} />
            </Pressable>
            <View style={styles.headerActions}>
              <Pressable
                onPress={() => navigation.navigate('Settings')}
                style={styles.backBtn}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Settings"
              >
                <Ionicons name="settings-outline" size={20} color={colors.white} />
              </Pressable>
              <Pressable
                onPress={onSignOut}
                style={styles.backBtn}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Sign out"
              >
                <Ionicons name="log-out-outline" size={20} color={colors.white} />
              </Pressable>
            </View>
          </View>
          <Text style={styles.overline}>BEGIN INSPECTION</Text>
          <Text style={styles.title}>Select Inspection Type</Text>
          <Text style={styles.subtitle}>
            Choose the type of inspection and property category
          </Text>
          <View style={styles.stepperWrap}>
            <Stepper steps={STEPS} current={currentStep} />
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        ref={scrollRef}
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {resumableDraft && (
          <Pressable style={styles.assignedBanner} onPress={onResumeDraft}>
            <Ionicons name="time-outline" size={20} color={colors.accentBlueFg} />
            <Text style={styles.assignedBannerText}>
              Unfinished inspection from last session — tap to resume
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.accentBlueFg} />
          </Pressable>
        )}

        {pendingQueue.length > 0 && (
          <Pressable
            style={styles.pendingBanner}
            onPress={() => {
              if (syncing) {
                Alert.alert('Still syncing', "Already uploading — this can take a minute for photo-heavy inspections. Give it a moment before tapping again.");
                return;
              }
              const started = retryNow();
              if (!started) {
                Alert.alert('Still syncing', "Already uploading — this can take a minute for photo-heavy inspections. Give it a moment before tapping again.");
              }
              setWaitingForWifi(false);
            }}
          >
            {syncing ? (
              <ActivityIndicator size="small" color={colors.warning} />
            ) : (
              <Ionicons name="cloud-upload-outline" size={20} color={colors.warning} />
            )}
            <Text style={styles.pendingBannerText}>
              {syncing
                ? `Syncing ${pendingQueue.length} inspection${pendingQueue.length === 1 ? '' : 's'}… this can take a minute`
                : `${pendingQueue.length} inspection${pendingQueue.length === 1 ? '' : 's'} waiting to sync${
                    waitingForWifi ? ' — waiting for Wi-Fi (tap to sync now anyway)' : ' — tap to retry now'
                  }`}
            </Text>
          </Pressable>
        )}

        {assignedCount > 0 && (
          <Pressable style={styles.assignedBanner} onPress={() => navigation.navigate('AssignedJobs')}>
            <Ionicons name="briefcase-outline" size={20} color={colors.accentBlueFg} />
            <Text style={styles.assignedBannerText}>
              {assignedCount} assigned job{assignedCount === 1 ? '' : 's'} waiting — tap to continue
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.accentBlueFg} />
          </Pressable>
        )}

        <SectionHeader index={1} title="INSPECTION TYPE" />
        {INSPECTION_TYPES.map((type) => (
          <InspectionTypeCard
            key={type.id}
            type={type}
            selected={typeId === type.id}
            onPress={() => onSelectType(type.id)}
          />
        ))}

        <View style={{ height: spacing.md }} />

        <View onLayout={(e) => { propertyY.current = e.nativeEvent.layout.y; }}>
          <SectionHeader index={2} title="PROPERTY TYPE" />
          {PROPERTY_TYPES.map((property) => {
            const disabled = !!selectedType && !applicable.has(property.id);
            return (
              <PropertyTypeRow
                key={property.id}
                property={property}
                selected={propertyId === property.id}
                disabled={disabled}
                onPress={() => setPropertyId(property.id)}
              />
            );
          })}
        </View>
      </ScrollView>

      {/* Sticky footer CTA */}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Button
          label="Begin Inspection"
          disabled={!canBegin}
          onPress={() => canBegin && setConfirmVisible(true)}
        />
        {!canBegin && (
          <Text style={styles.footerHint}>
            {!typeId ? 'Select an inspection type to continue' : 'Select a property type to continue'}
          </Text>
        )}
      </SafeAreaView>

      <ConfirmStartModal
        visible={confirmVisible}
        onCancel={() => setConfirmVisible(false)}
        onConfirm={onConfirmStart}
      />
    </View>
  );
}

function SectionHeader({ index, title }: { index: number; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionBadge}>
        <Text style={styles.sectionBadgeText}>{index}</Text>
      </View>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xl },
  headerTopRow: { marginTop: spacing.sm, flexDirection: 'row', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', gap: spacing.sm },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overline: {
    ...typography.overline,
    color: colors.textOnDarkMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  title: { ...typography.h2, color: colors.white, textAlign: 'center', marginTop: 2 },
  subtitle: {
    ...typography.bodySm,
    color: colors.textOnDarkMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  stepperWrap: { marginTop: spacing.xl },
  body: { flex: 1 },
  bodyContent: { padding: spacing.xl, paddingBottom: spacing.xxxl },
  assignedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  assignedBannerText: { ...typography.bodySm, fontWeight: '600', color: colors.accentBlueFg, flex: 1 },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warning + '1a',
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  pendingBannerText: { ...typography.bodySm, fontWeight: '600', color: colors.warning, flex: 1 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  sectionBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.stepActive,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  sectionBadgeText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  sectionTitle: { ...typography.sectionTitle, color: colors.textPrimary },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerHint: {
    ...typography.caption,
    color: colors.accentBlueFg,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
