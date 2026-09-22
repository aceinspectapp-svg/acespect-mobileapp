import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { Button } from '../../components/ui';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { AppScreenProps } from '../../navigation/types';
import {
  acceptProfileTemplateUpdates,
  describeTemplateProfile,
  getTemplateUpdates,
  TemplateProfileUpdate,
} from '../../services/templateApi';

/**
 * Lets an inspector accept a newly-published template on their own schedule.
 * Applying an update here only changes what a NEW inspection uses going
 * forward -- an inspection already in progress keeps rendering whatever it
 * started with, whether or not this screen was ever opened (see
 * pinAllSectionTemplates.ts).
 */
export function TemplateUpdatesScreen({ navigation }: AppScreenProps<'TemplateUpdates'>) {
  const [updates, setUpdates] = useState<TemplateProfileUpdate[] | null>(null);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    getTemplateUpdates()
      .then(setUpdates)
      .catch(() => setError(true));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function apply(update: TemplateProfileUpdate) {
    const key = `${update.inspectionType}:${update.propertyType}`;
    setApplyingKey(key);
    try {
      await acceptProfileTemplateUpdates(update.inspectionType, update.propertyType);
      load();
    } finally {
      setApplyingKey(null);
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <InspectionHeader title="Template Updates" onBack={() => navigation.goBack()} />

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
        {updates === null && !error && (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}

        {error && (
          <View style={styles.centerState}>
            <Text style={styles.emptyText}>Couldn't load template updates. Pull to refresh or try again later.</Text>
          </View>
        )}

        {updates !== null && updates.length === 0 && !error && (
          <View style={styles.centerState}>
            <Ionicons name="checkmark-circle-outline" size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>You're up to date. No template updates are waiting.</Text>
          </View>
        )}

        {updates?.map((update) => {
          const key = `${update.inspectionType}:${update.propertyType}`;
          return (
            <View key={key} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{describeTemplateProfile(update.inspectionType, update.propertyType)}</Text>
                <View style={styles.statusPill}>
                  <Text style={styles.statusPillText}>Update Available</Text>
                </View>
              </View>
              <Text style={styles.cardHint}>
                {update.pendingSections.length} section{update.pendingSections.length === 1 ? '' : 's'} updated by
                admin. Your inspections in progress keep using the version they started with -- this only affects
                inspections you start after applying.
              </Text>
              <Button
                label={applyingKey === key ? 'Applying…' : 'Apply Update'}
                onPress={() => apply(update)}
                disabled={applyingKey === key}
                loading={applyingKey === key}
                variant="primary"
              />
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },

  centerState: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyText: { ...typography.bodySm, color: colors.textMuted, textAlign: 'center' },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { ...typography.body, fontWeight: '700', color: colors.textPrimary, flex: 1 },
  cardHint: { ...typography.caption, color: colors.textMuted, lineHeight: 17 },

  statusPill: { backgroundColor: colors.primaryTint, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  statusPillText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
});
