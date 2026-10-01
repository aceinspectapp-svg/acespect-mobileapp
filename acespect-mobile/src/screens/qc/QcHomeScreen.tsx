import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography } from '../../theme';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { AppScreenProps } from '../../navigation/types';
import { useQcData } from '../../context/QcDataContext';
import { useAuth } from '../../context/AuthContext';

interface PropertyCard {
  propertyId: string;
  propertyName: string;
  projectName: string;
  clientName: string;
  defectCount: number;
}

/**
 * QC's landing screen -- the properties you have assigned work in, derived
 * from your own assigned tasks (one task per defect today), same as the old
 * branch's property picker. Tapping one opens QcPropertyHomeScreen's module
 * grid, scoped to just that property's Defects/Tasks. Client/project/
 * property config and defect creation stay admin-only on acespect-web.
 */
export function QcHomeScreen({ navigation }: AppScreenProps<'QcHome'>) {
  const { tasks, loading, error, refreshTasks } = useQcData();
  const { signOut } = useAuth();

  useFocusEffect(
    useCallback(() => {
      refreshTasks();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const properties = useMemo<PropertyCard[]>(() => {
    const byId = new Map<string, PropertyCard>();
    const defectIdsByProperty = new Map<string, Set<string>>();
    for (const t of tasks) {
      const p = t.defect.property;
      if (!byId.has(p.id)) {
        byId.set(p.id, {
          propertyId: p.id,
          propertyName: p.name,
          projectName: t.defect.project.name,
          clientName: t.defect.client.name,
          defectCount: 0,
        });
        defectIdsByProperty.set(p.id, new Set());
      }
      defectIdsByProperty.get(p.id)!.add(t.defect.id);
    }
    for (const card of byId.values()) card.defectCount = defectIdsByProperty.get(card.propertyId)!.size;
    return Array.from(byId.values()).sort((a, b) => a.propertyName.localeCompare(b.propertyName));
  }, [tasks]);

  const onSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  return (
    <View style={styles.root}>
      <InspectionHeader
        title="QC"
        subtitle="Client & project defect tracking"
        onBack={() => navigation.goBack()}
        actions={[{ icon: 'log-out-outline', onPress: onSignOut, accessibilityLabel: 'Sign out' }]}
      />

      {loading && properties.length === 0 && (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentBlueFg} />
        </View>
      )}
      {error && properties.length === 0 && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => refreshTasks()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        data={properties}
        keyExtractor={(p) => p.propertyId}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={refreshTasks}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate('QcPropertyHome', { propertyId: item.propertyId })}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            accessibilityRole="button"
            accessibilityLabel={item.propertyName}
          >
            <View style={styles.iconTile}>
              <Ionicons name="business-outline" size={26} color={colors.accentBlueFg} />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>{item.propertyName}</Text>
              <Text style={styles.cardSub}>{item.projectName} · {item.clientName}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </Pressable>
        )}
        ListEmptyComponent={
          !loading && !error ? <Text style={styles.empty}>No properties with assigned work yet.</Text> : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxxl, gap: spacing.md },
  errorText: { ...typography.bodySm, color: colors.danger, textAlign: 'center' },
  retryBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primaryTint },
  retryText: { ...typography.bodySm, color: colors.primary, fontWeight: '700' },
  list: { padding: spacing.xl, paddingBottom: spacing.xxxl, flexGrow: 1, gap: spacing.lg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.card,
  },
  cardPressed: { opacity: 0.92 },
  iconTile: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.accentBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, marginLeft: spacing.lg },
  cardTitle: { ...typography.h3, color: colors.textPrimary },
  cardSub: { ...typography.bodySm, color: colors.textMuted, marginTop: 2 },
  empty: { ...typography.bodySm, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xxxl },
});
