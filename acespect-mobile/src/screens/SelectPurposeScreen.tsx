import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography } from '../theme';
import { AppScreenProps } from '../navigation/types';
import { useAuth } from '../context/AuthContext';

/**
 * First screen after login. Picks which of the app's two purposes to enter —
 * does not belong to either flow itself, so it never navigates with
 * `replace`/`reset`: both branches remain one back-tap away from here.
 */
export function SelectPurposeScreen({ navigation }: AppScreenProps<'SelectPurpose'>) {
  const { signOut } = useAuth();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient colors={[colors.headerGradientFrom, colors.headerGradientTo]} style={styles.header}>
        <SafeAreaView edges={['top']}>
          <View style={styles.headerTopRow}>
            <View style={{ width: 38 }} />
            <Pressable
              onPress={() => signOut()}
              style={styles.signOutBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
            >
              <Ionicons name="log-out-outline" size={20} color={colors.white} />
            </Pressable>
          </View>
          <Text style={styles.overline}>WELCOME</Text>
          <Text style={styles.title}>What are you working on?</Text>
          <Text style={styles.subtitle}>Choose the app to continue into</Text>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.body}>
        <Pressable
          onPress={() => navigation.navigate('SelectInspectionType')}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          accessibilityRole="button"
          accessibilityLabel="Houspect"
        >
          <View style={[styles.iconTile, { backgroundColor: colors.accentIndigo }]}>
            <Ionicons name="document-text-outline" size={30} color={colors.accentIndigoFg} />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>Houspect</Text>
            <Text style={styles.cardSub}>Dilapidation, pre-purchase & stage inspections</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>

        <Pressable
          onPress={() => navigation.navigate('QcTasksList')}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          accessibilityRole="button"
          accessibilityLabel="QC"
        >
          <View style={[styles.iconTile, { backgroundColor: colors.accentBlue }]}>
            <Ionicons name="shield-checkmark-outline" size={30} color={colors.accentBlueFg} />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>QC</Text>
            <Text style={styles.cardSub}>Client & project defect tracking</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl },
  headerTopRow: { marginTop: spacing.sm, flexDirection: 'row', justifyContent: 'space-between' },
  signOutBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overline: { ...typography.overline, color: colors.textOnDarkMuted, textAlign: 'center', marginTop: spacing.sm },
  title: { ...typography.h2, color: colors.white, textAlign: 'center', marginTop: 2 },
  subtitle: { ...typography.bodySm, color: colors.textOnDarkMuted, textAlign: 'center', marginTop: spacing.xs },
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
