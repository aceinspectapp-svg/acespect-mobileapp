import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography } from '../../theme';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { AppScreenProps } from '../../navigation/types';
import { useAuth } from '../../context/AuthContext';

/**
 * QC's landing screen -- branches into the two things the backend already
 * scopes to "mine": the Defects list (view/edit a defect's own details) and
 * the Tasks list (site-visit activity log, comments + photos). Client/
 * project/property/defect creation stays admin-only on acespect-web.
 */
export function QcHomeScreen({ navigation }: AppScreenProps<'QcHome'>) {
  const { signOut } = useAuth();

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
      <View style={styles.body}>
        <Pressable
          onPress={() => navigation.navigate('QcDefectsList')}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          accessibilityRole="button"
          accessibilityLabel="Defects"
        >
          <View style={[styles.iconTile, { backgroundColor: colors.accentPurple }]}>
            <Ionicons name="alert-circle-outline" size={28} color={colors.accentPurpleFg} />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>Defects</Text>
            <Text style={styles.cardSub}>View and fill in defects assigned to you</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>

        <Pressable
          onPress={() => navigation.navigate('QcTasksList')}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          accessibilityRole="button"
          accessibilityLabel="Tasks"
        >
          <View style={[styles.iconTile, { backgroundColor: colors.accentGreen }]}>
            <Ionicons name="checkbox-outline" size={28} color={colors.accentGreenFg} />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>Tasks</Text>
            <Text style={styles.cardSub}>Log site visits, comments & photos</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing.xl, gap: spacing.lg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.card,
  },
  cardPressed: { opacity: 0.92 },
  iconTile: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, marginLeft: spacing.lg },
  cardTitle: { ...typography.h3, color: colors.textPrimary },
  cardSub: { ...typography.bodySm, color: colors.textMuted, marginTop: 2 },
});
