import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { AppTextInput, Button, Checkbox } from '../../components/ui';
import { MfaEnrollNeeded, useAuth } from '../../context/AuthContext';
import { authApi } from '../../services/authApi';
import { getApiErrorMessage } from '../../services/apiError';
import type { InvitationInfo } from '../../types/auth';
import type { AuthScreenProps } from '../../navigation/types';

const MIN_PASSWORD = 12; // the same rule the server and the web portal enforce

/** Accepts what was pasted: the whole invitation link, or just the code at the end of it. Returns null when it does not look like either. */
export function extractInvitationToken(input: string): string | null {
  const text = input.trim();
  const fromLink = /\/accept\/([A-Za-z0-9_-]{16,})/.exec(text)?.[1];
  const token = fromLink ?? (/^[A-Za-z0-9_-]{16,}$/.test(text) ? text : null);
  return token;
}

/**
 * Activates an account the company's administrator has already created for you (a client, builder, trade or inspector invited to ACE SPECT QC).
 * Those accounts cannot be made with "Create account" -- the email is already taken -- so the person pastes the invitation link they were sent,
 * checks who it is for, chooses a password and is signed in.
 */
export function AcceptInvitationScreen({ navigation, route }: AuthScreenProps<'AcceptInvitation'>) {
  const { acceptInvitation, isLoading } = useAuth();
  const [code, setCode] = useState(route.params?.token ?? '');
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = extractInvitationToken(code);
  const longEnough = password.length >= MIN_PASSWORD;
  const matches = confirm.length > 0 && confirm === password;
  const canActivate = !!info && longEnough && matches && agreed && !isLoading;

  const check = async () => {
    setError(null);
    if (!token) {
      setError('That does not look like an invitation link or code. Paste the whole link from your invitation email or message.');
      return;
    }
    setChecking(true);
    try {
      setInfo(await authApi.invitationInfo(token));
    } catch (e) {
      setInfo(null);
      setError(getApiErrorMessage(e, 'This invitation could not be checked. Check your connection and try again.'));
    } finally {
      setChecking(false);
    }
  };

  const activate = async () => {
    if (!token || !info) return;
    setError(null);
    try {
      await acceptInvitation(token, password);
      // Signed in: the app switches to the signed-in screens by itself.
    } catch (e) {
      if (e instanceof MfaEnrollNeeded) {
        Alert.alert(
          'Account activated',
          'Your password is set. Your role also needs two-step verification: open the ACE SPECT web portal, sign in and follow the prompts to set it up. Then sign in here.',
          [{ text: 'OK', onPress: () => navigation.navigate('Login') }],
        );
        return;
      }
      setError(getApiErrorMessage(e, 'Your account could not be activated. Please try again.'));
    }
  };

  const rule = (ok: boolean, text: string) => (
    <View style={styles.ruleRow}>
      <Ionicons name={ok ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={ok ? colors.success : colors.textMuted} />
      <Text style={[styles.ruleText, ok && { color: colors.success }]}>{text}</Text>
    </View>
  );

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <SafeAreaView edges={['top']} style={styles.flex}>
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Pressable onPress={() => navigation.goBack()} style={styles.back} hitSlop={10} accessibilityRole="button" accessibilityLabel="Go back">
              <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
            </Pressable>

            <Text style={styles.title}>Activate your invitation</Text>
            <Text style={styles.subtitle}>
              Your company invited you to ACE SPECT. Paste the invitation link (or just the code at the end of it) to set your password and sign in.
            </Text>

            <View style={styles.form}>
              <AppTextInput
                label="Invitation link or code"
                placeholder="https://…/accept/…"
                leftIcon="link-outline"
                autoCapitalize="none"
                autoCorrect={false}
                value={code}
                onChangeText={(t) => { setCode(t); setInfo(null); setError(null); }}
              />
              {!info && <Button label={checking ? 'Checking…' : 'Check invitation'} onPress={check} disabled={checking || code.trim().length === 0} loading={checking} />}
            </View>

            {info && (
              <>
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Welcome{info.name ? `, ${info.name}` : ''}</Text>
                  <Text style={styles.cardLine}>{info.email}</Text>
                  {(info.organisations ?? []).map((o, i) => (
                    <Text key={i} style={styles.cardLine}>{o.clientName} · {o.role.replace(/_/g, ' ').toLowerCase()}</Text>
                  ))}
                </View>

                <View style={styles.form}>
                  <AppTextInput label="Choose a password" placeholder="At least 12 characters" leftIcon="lock-closed-outline" password autoCapitalize="none" value={password} onChangeText={setPassword} />
                  <AppTextInput
                    label="Confirm password"
                    placeholder="Type it again"
                    leftIcon="lock-closed-outline"
                    password
                    autoCapitalize="none"
                    value={confirm}
                    onChangeText={setConfirm}
                    error={confirm.length > 0 && confirm !== password ? 'Passwords do not match' : undefined}
                  />
                  <View style={styles.rules}>
                    {rule(longEnough, `At least ${MIN_PASSWORD} characters`)}
                    {rule(matches, 'Both passwords match')}
                  </View>
                </View>

                <Pressable style={styles.termsRow} onPress={() => setAgreed((v) => !v)}>
                  <Checkbox checked={agreed} onChange={setAgreed} />
                  <Text style={styles.termsText}>I accept the privacy collection notice and terms of use ({info.termsVersion}).</Text>
                </Pressable>

                <Button label={isLoading ? 'Activating…' : 'Activate and sign in'} onPress={activate} disabled={!canActivate} loading={isLoading} />
              </>
            )}

            {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}

            <View style={styles.help}>
              <Text style={styles.helpText}>
                No invitation yet, or the link has expired? Ask your administrator to send a new one — it can be resent from the People page of the ACE SPECT web portal.
              </Text>
              <Pressable onPress={() => navigation.navigate('Login')} hitSlop={8}>
                <Text style={styles.link}>Already activated? Sign in</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2, gap: spacing.md },
  back: { alignSelf: 'flex-start', paddingVertical: spacing.sm },
  title: { ...typography.h2, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary },
  form: { gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 2 },
  cardTitle: { ...typography.h3, color: colors.textPrimary },
  cardLine: { ...typography.caption, color: colors.textSecondary },
  rules: { gap: 4 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ruleText: { ...typography.caption, color: colors.textMuted },
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  termsText: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  error: { ...typography.caption, color: colors.danger },
  help: { marginTop: spacing.md, gap: spacing.sm },
  helpText: { ...typography.caption, color: colors.textMuted },
  link: { ...typography.caption, color: colors.accentBlueFg, fontWeight: '600' },
});
