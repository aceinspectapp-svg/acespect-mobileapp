import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
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
  headerTopRow: { marginTop: spacing.sm },
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
