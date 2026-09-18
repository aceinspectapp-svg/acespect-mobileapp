import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, typography } from '../../theme';
import { AppTextInput, Button, Checkbox } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useGoogleSignIn } from '../../hooks/useGoogleSignIn';
import { getApiErrorMessage } from '../../services/apiError';
import { AuthScreenProps } from '../../navigation/types';

export function SignUpScreen({ navigation }: AuthScreenProps<'SignUp'>) {
  const { register, loginWithGoogleIdToken, isLoading } = useAuth();
  const google = useGoogleSignIn(loginWithGoogleIdToken);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordsMismatch = confirm.length > 0 && confirm !== password;

  const canSubmit =
    fullName.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 8 &&
    confirm === password &&
    agreed &&
    !isLoading;

  const onSignUp = async () => {
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (!agreed) {
      setError('Please accept the Terms & Conditions to continue.');
      return;
    }
    try {
      await register({
        name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        password,
      });
      Alert.alert('Success', 'Account created — you should be signed in now.');
      // On success AuthContext sets the user and navigation switches to the app.
    } catch (e) {
      const msg = getApiErrorMessage(e, 'Could not create your account. Please try again.');
      console.error('SignUp error', e, msg);
      setError(msg);
      Alert.alert('Signup failed', msg);
    }
  };

  // Helper for explaining why the CTA is disabled in the UI (dev-friendly)
  const disabledReasons: string[] = [];
  if (fullName.trim().length === 0) disabledReasons.push('Full name is required');
  if (email.trim().length === 0) disabledReasons.push('Email is required');
  if (password.length < 8) disabledReasons.push('Password must be at least 8 characters');
  if (confirm !== password) disabledReasons.push('Passwords must match');
  if (!agreed) disabledReasons.push('Accept Terms & Conditions');

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <SafeAreaView edges={['top']} style={styles.safe}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Pressable
              onPress={() => navigation.goBack()}
              style={styles.back}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
            </Pressable>

            {/* Brand */}
            <View style={styles.brandWrap}>
              <View style={styles.brandRow}>
                <MaterialCommunityIcons name="chart-bar" size={24} color={colors.primary} />
                <Text style={styles.brand}>
                  <Text style={styles.brandRed}>ACE </Text>
                  <Text style={styles.brandNavy}>SPECT</Text>
                </Text>
              </View>
              <Text style={styles.brandTag}>QUALITY INSPECTIONS ASSURED</Text>
            </View>

            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>Sign up to get started</Text>

            <View style={styles.form}>
              <AppTextInput
                label="Full Name"
                placeholder="Enter your full name"
                leftIcon="person-outline"
                autoCapitalize="words"
                value={fullName}
                onChangeText={setFullName}
              />
              <Field />
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
              <Field />
              <AppTextInput
                label="Phone Number"
                placeholder="Enter your phone number"
                leftIcon="call-outline"
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
              />
              <Field />
              <AppTextInput
                label="Password"
                placeholder="Create a password"
                leftIcon="lock-closed-outline"
                password
                autoCapitalize="none"
                value={password}
                onChangeText={setPassword}
              />
              <Field />
              <AppTextInput
                label="Confirm Password"
                placeholder="Confirm your password"
                leftIcon="lock-closed-outline"
                password
                autoCapitalize="none"
                value={confirm}
                onChangeText={setConfirm}
                error={passwordsMismatch ? 'Passwords do not match' : undefined}
              />
            </View>

            <Pressable style={styles.termsRow} onPress={() => setAgreed((v) => !v)}>
              <Checkbox checked={agreed} onChange={setAgreed} />
              <Text style={styles.termsText}>
                I agree to the <Text style={styles.link}>Terms &amp; Conditions</Text> and{' '}
                <Text style={styles.link}>Privacy Policy</Text>
              </Text>
            </Pressable>

            {!!(error || google.error) && (
              <Text style={styles.errorBanner}>{error || google.error}</Text>
            )}

            <Button
              label="SIGN UP"
              onPress={onSignUp}
              disabled={!canSubmit}
              loading={isLoading}
              style={styles.cta}
            />

            {!canSubmit && (
              <Text style={styles.disabledHelp} accessibilityRole="text">
                {disabledReasons.join(' • ')}
              </Text>
            )}

            <View style={styles.dividerRow}>
              <View style={styles.divider} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.divider} />
            </View>

            <Button
              label="Sign up with Google"
              variant="outline"
              leftIcon="logo-google"
              onPress={google.signIn}
              loading={google.busy}
              disabled={isLoading}
            />

            <View style={styles.signinRow}>
              <Text style={styles.signinText}>Already have an account? </Text>
              <Pressable hitSlop={6} onPress={() => navigation.navigate('Login')}>
                <Text style={styles.signinLink}>Sign In</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

/** Vertical gap between form fields. */
function Field() {
  return <View style={{ height: spacing.lg }} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl },
  back: { width: 40, height: 40, justifyContent: 'center', marginTop: spacing.sm },
  brandWrap: { alignItems: 'center', marginTop: spacing.sm },
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  brand: { marginLeft: spacing.sm, ...typography.h2, letterSpacing: 2 },
  brandRed: { color: colors.primary, fontWeight: '800' },
  brandNavy: { color: colors.textPrimary, fontWeight: '800' },
  brandTag: {
    ...typography.overline,
    color: colors.textMuted,
    fontSize: 9,
    marginTop: 4,
  },
  title: { ...typography.h2, color: colors.textPrimary, textAlign: 'center', marginTop: spacing.xl },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  form: { marginTop: spacing.xxl },
  termsRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl },
  termsText: {
    ...typography.bodySm,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
    flex: 1,
    lineHeight: 18,
  },
  link: { color: colors.primary, fontWeight: '600' },
  errorBanner: { ...typography.caption, color: colors.danger, marginTop: spacing.md },
  cta: { marginTop: spacing.xl },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.xl },
  divider: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { ...typography.bodySm, color: colors.textMuted, marginHorizontal: spacing.md },
  signinRow: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.xl },
  signinText: { ...typography.bodySm, color: colors.textSecondary },
  signinLink: { ...typography.bodySm, color: colors.primary, fontWeight: '700' },
  disabledHelp: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
