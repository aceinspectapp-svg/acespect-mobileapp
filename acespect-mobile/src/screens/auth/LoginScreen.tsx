import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { AppTextInput, Button, Checkbox } from '../../components/ui';
import { MfaChallenge, useAuth } from '../../context/AuthContext';
import { useGoogleSignIn } from '../../hooks/useGoogleSignIn';
import { GOOGLE_AUTH_ENABLED } from '../../config/google';
import { getApiErrorMessage } from '../../services/apiError';
import { AuthScreenProps } from '../../navigation/types';

export function LoginScreen({ navigation }: AuthScreenProps<'Login'>) {
  const { signIn, verifyMfa, loginWithGoogleIdToken, isLoading } = useAuth();
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const google = useGoogleSignIn(loginWithGoogleIdToken);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !isLoading;

  const onSignIn = async () => {
    setError(null);
    if (!canSubmit) return;
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      if (e instanceof MfaChallenge) {
        setMfaToken(e.mfaToken);
        return;
      }
      setError(getApiErrorMessage(e, 'Unable to sign in. Please check your credentials.'));
    }
  };

  const onVerify = async () => {
    setError(null);
    if (!mfaToken || code.trim().length < 6) return;
    try {
      await verifyMfa(mfaToken, code.trim());
    } catch (e) {
      setError(getApiErrorMessage(e, 'That code is not valid.'));
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* Dark hero */}
      <LinearGradient
        colors={[colors.headerGradientFrom, colors.headerGradientTo]}
        style={styles.hero}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.brandRow}>
            <MaterialCommunityIcons name="chart-bar" size={26} color={colors.primary} />
            <Text style={styles.brand}>
              <Text style={styles.brandRed}>ACE </Text>
              <Text style={styles.brandWhite}>SPECT</Text>
            </Text>
            <Ionicons name="search" size={18} color={colors.textOnDarkMuted} style={styles.brandSearch} />
          </View>
          <Text style={styles.brandTag}>QUALITY INSPECTIONS ASSURED</Text>

          <Text style={styles.heroTitle}>Welcome Back!</Text>
          <Text style={styles.heroSubtitle}>
            Sign in to access your inspection jobs and reports.
          </Text>
        </SafeAreaView>
      </LinearGradient>

      {/* Form sheet */}
      <KeyboardAvoidingView
        style={styles.sheetWrap}
        behavior="padding"
      >
        <ScrollView
          contentContainerStyle={styles.sheet}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {mfaToken ? (
            <>
              <Text style={styles.heroSubtitle}>Enter the 6-digit code from your authenticator app, or one of your backup codes.</Text>
              <View style={{ height: spacing.lg }} />
              <AppTextInput
                label="Verification code"
                placeholder="123456"
                leftIcon="key-outline"
                keyboardType="number-pad"
                autoCapitalize="none"
                value={code}
                onChangeText={setCode}
                onSubmitEditing={onVerify}
                returnKeyType="go"
              />
              {!!error && <Text style={styles.errorBanner}>{error}</Text>}
              <View style={{ height: spacing.lg }} />
              <Button label="VERIFY" onPress={onVerify} disabled={code.trim().length < 6 || isLoading} loading={isLoading} />
              <View style={{ height: spacing.md }} />
              <Button label="Back" variant="outline" onPress={() => { setMfaToken(null); setCode(''); setError(null); }} />
            </>
          ) : (
          <>
          <AppTextInput
            label="Email Address"
            placeholder="Enter your email"
            leftIcon="mail-outline"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
          />

          <View style={{ height: spacing.lg }} />

          <AppTextInput
            label="Password"
            placeholder="Enter your password"
            leftIcon="lock-closed-outline"
            password
            autoCapitalize="none"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={onSignIn}
            returnKeyType="go"
          />

          {!!(error || google.error) && (
            <Text style={styles.errorBanner}>{error || google.error}</Text>
          )}

          <View style={styles.metaRow}>
            <Checkbox checked={remember} onChange={setRemember} label="Remember me" />
            <Pressable hitSlop={6}>
              <Text style={styles.forgot}>Forgot Password?</Text>
            </Pressable>
          </View>

          <Button
            label="SIGN IN"
            onPress={onSignIn}
            disabled={!canSubmit}
            loading={isLoading}
          />

          {GOOGLE_AUTH_ENABLED && (
            <>
              <View style={styles.dividerRow}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.divider} />
              </View>

              <Button
                label="Sign in with Google"
                variant="outline"
                leftIcon="logo-google"
                onPress={google.signIn}
                loading={google.busy}
                disabled={isLoading}
              />
            </>
          )}

          <View style={styles.signupRow}>
            <Text style={styles.signupText}>Don't have an account? </Text>
            <Pressable hitSlop={6} onPress={() => navigation.navigate('SignUp')}>
              <Text style={styles.signupLink}>Sign Up</Text>
            </Pressable>
          </View>
          </>
          )}

          <View style={styles.footer}>
            <View style={styles.footerLeft}>
              <Ionicons name="shield-checkmark-outline" size={14} color={colors.textMuted} />
              <Text style={styles.footerText}> Secure Login</Text>
            </View>
            <Text style={styles.footerText}>Version 1.0.0</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.headerGradientFrom },
  hero: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxl,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg },
  brand: { marginLeft: spacing.sm, ...typography.h2, letterSpacing: 2 },
  brandRed: { color: colors.primary, fontWeight: '800' },
  brandWhite: { color: colors.white, fontWeight: '800' },
  brandSearch: { marginLeft: spacing.sm },
  brandTag: {
    ...typography.overline,
    color: colors.textOnDarkMuted,
    marginTop: 2,
    marginLeft: 34,
    fontSize: 9,
  },
  heroTitle: { ...typography.h1, color: colors.white, marginTop: spacing.xxl },
  heroSubtitle: {
    ...typography.body,
    color: colors.textOnDarkMuted,
    marginTop: spacing.sm,
  },
  sheetWrap: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    marginTop: -spacing.xl,
  },
  sheet: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxl,
  },
  errorBanner: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.md,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: spacing.lg,
  },
  forgot: { ...typography.label, color: colors.primary },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.xl },
  divider: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { ...typography.bodySm, color: colors.textMuted, marginHorizontal: spacing.md },
  signupRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  signupText: { ...typography.bodySm, color: colors.textSecondary },
  signupLink: { ...typography.bodySm, color: colors.primary, fontWeight: '700' },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xxxl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerLeft: { flexDirection: 'row', alignItems: 'center' },
  footerText: { ...typography.caption, color: colors.textMuted },
});
