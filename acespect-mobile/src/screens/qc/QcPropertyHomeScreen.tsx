import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, typography } from '../../theme';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { ModuleTile } from '../../components/qc/ModuleTile';
import { QcNavBar } from '../../components/qc/QcNavBar';
import { AppScreenProps } from '../../navigation/types';
import { useQcData } from '../../context/QcDataContext';

/**
 * One property's module grid -- Defects and Tasks are live (both scoped to
 * this property), Drawings/Inspections/Daily Reports are placeholders
 * matching the original QC prototype's design, since none of those three
 * exist as real features yet.
 */
export function QcPropertyHomeScreen({ navigation, route }: AppScreenProps<'QcPropertyHome'>) {
  const { propertyId } = route.params;
  const { tasks, refreshTasks, loading } = useQcData();

  useFocusEffect(
    useCallback(() => {
      refreshTasks();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const propertyTasks = useMemo(() => tasks.filter((t) => t.defect.property.id === propertyId), [tasks, propertyId]);
  const defectCount = useMemo(() => new Set(propertyTasks.map((t) => t.defect.id)).size, [propertyTasks]);
  const first = propertyTasks[0]?.defect;

  const soon = (label: string) => Alert.alert(label, `${label} isn't wired up yet — coming in a later update.`);

  if (!first && loading) {
    return (
      <View style={styles.root}>
        <InspectionHeader title="Property" onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentBlueFg} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <InspectionHeader
        title={first?.project.name ?? 'Property'}
        subtitle={first ? `${first.property.name} · ${first.client.name}` : undefined}
        onBack={() => navigation.goBack()}
        actions={[{ icon: 'swap-horizontal-outline', onPress: () => navigation.navigate('QcHome'), accessibilityLabel: 'Switch property' }]}
      />

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.sectionTitle}>MODULES</Text>
        <View style={styles.grid}>
          <ModuleTile
            icon="alert-circle-outline"
            label="Defects"
            sub={`${defectCount} item${defectCount === 1 ? '' : 's'}`}
            iconBg={colors.primaryTint}
            iconFg={colors.danger}
            onPress={() => navigation.navigate('QcDefectsList', { propertyId })}
          />
          <ModuleTile
            icon="layers-outline"
            label="Drawings"
            sub="Coming soon"
            iconBg={colors.accentBlue}
            iconFg={colors.accentBlueFg}
            onPress={() => soon('Drawings')}
            soon
          />
          <ModuleTile
            icon="clipboard-outline"
            label="Inspections"
            sub="Coming soon"
            iconBg={colors.accentPurple}
            iconFg={colors.accentPurpleFg}
            onPress={() => soon('Inspections')}
            soon
          />
          <ModuleTile
            icon="bar-chart-outline"
            label="Daily Reports"
            sub="Coming soon"
            iconBg={colors.accentIndigo}
            iconFg={colors.accentIndigoFg}
            onPress={() => soon('Daily Reports')}
            soon
          />
        </View>
      </ScrollView>

      <QcNavBar
        active="home"
        onTab={(tab) => {
          if (tab === 'tasks') navigation.navigate('QcTasksList', { propertyId });
          else if (tab === 'profile') soon('Profile');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  sectionTitle: { ...typography.sectionTitle, color: colors.textMuted, marginBottom: spacing.md, marginLeft: spacing.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
});
