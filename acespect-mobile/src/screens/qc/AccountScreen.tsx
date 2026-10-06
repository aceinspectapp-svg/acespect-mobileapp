import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Switch, Text, View, Pressable } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { AppTextInput, Button } from '../../components/ui';
import { AppScreenProps } from '../../navigation/types';
import { useAuth } from '../../context/AuthContext';
import { useQcMe } from '../../hooks/useQcMe';
import { useDefectSync } from '../../hooks/useDefectSync';
import { discardEntry } from '../../services/defectQueue';
import { errorMessage } from '../../services/qcCache';
import * as account from '../../services/accountApi';

const ROLE: Record<string, string> = {
  SA: 'Super Admin', CLIENT_ADMIN: 'Client Admin', CLIENT_USER: 'Client User', MC_MANAGER: 'Master Contractor Manager', MC_SITE_SUPERVISOR: 'Site Supervisor',
  MC_PROJECT_MANAGER: 'Project Manager', TRADE_USER: 'Trade User', PRIVATE_INSPECTOR: 'Private Inspector',
};
const EMAIL_CHOICES: Array<{ key: account.NotificationEventPref['email']; label: string }> = [
  { key: 'IMMEDIATE', label: 'Email now' },
  { key: 'DIGEST', label: 'Daily digest' },
  { key: 'OFF', label: 'No email' },
];

/** The person's own account: who they are, anything waiting to send, notification choices, password and two-factor sign-in. */
export function QcAccountScreen({ navigation }: AppScreenProps<'QcAccount'>) {
  const { signOut } = useAuth();
  const { me } = useQcMe();
  const sync = useDefectSync();
  const [user, setUser] = useState<account.AccountMe['user'] | null>(null);
  const [prefs, setPrefs] = useState<account.NotificationEventPref[] | null>(null);
  const [prefsDirty, setPrefsDirty] = useState(false);

  const loadUser = useCallback(() => { account.getAccount().then((r) => setUser(r.user)).catch(() => undefined); }, []);
  useEffect(() => {
    loadUser();
    account.getNotificationPrefs().then((r) => setPrefs(r.data)).catch(() => undefined);
  }, [loadUser]);

  const setPref = (type: string, patch: Partial<account.NotificationEventPref>) => {
    setPrefs((p) => (p ? p.map((e) => (e.type === type ? { ...e, ...patch } : e)) : p));
    setPrefsDirty(true);
  };
  async function savePrefs() {
    if (!prefs) return;
    try {
      await account.saveNotificationPrefs(prefs.filter((e) => !e.mandatory).map((e) => ({ type: e.type, inApp: e.inApp, email: e.email })));
      setPrefsDirty(false);
      Alert.alert('Saved', 'Your notification choices are saved.');
    } catch (e) {
      Alert.alert('Could not save', errorMessage(e));
    }
  }

  return (
    <View style={styles.root}>
      <InspectionHeader title="Account" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.name}>{user?.name ?? user?.email ?? '…'}</Text>
          {!!user?.name && <Text style={styles.sub}>{user.email}</Text>}
          {!!me && <Text style={styles.role}>{ROLE[me.role] ?? me.role}{me.clients.find((c) => c.id === me.clientId) ? ` · ${me.clients.find((c) => c.id === me.clientId)!.name}` : ''}</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>WAITING TO SEND ({sync.pending})</Text>
          {sync.pending === 0 && <Text style={styles.sub}>Nothing is waiting. Everything you did is on the server.</Text>}
          {sync.entries.map((e) => (
            <View key={e.id} style={styles.entry}>
              <Text style={styles.entryTitle}>{e.label}</Text>
              <Text style={styles.sub}>{new Date(e.createdAt).toLocaleString()}</Text>
              {!!e.error && <Text style={styles.err}>{e.error}</Text>}
              <Pressable onPress={() => Alert.alert('Discard this?', 'It has not been sent and will be lost.', [{ text: 'Keep', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => void discardEntry(e.id) }])} hitSlop={8}>
                <Text style={styles.link}>Discard</Text>
              </Pressable>
            </View>
          ))}
          {sync.pending > 0 && <Button label={sync.syncing ? 'Sending…' : 'Send now'} variant="outline" disabled={sync.syncing} onPress={() => void sync.syncNow()} />}
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>NOTIFICATIONS</Text>
          {!prefs && <Text style={styles.sub}>Loading…</Text>}
          {prefs?.map((e) => (
            <View key={e.type} style={styles.pref}>
              <View style={styles.prefHead}>
                <Text style={styles.entryTitle}>{e.label}</Text>
                <Switch value={e.inApp} disabled={e.mandatory} onValueChange={(v) => setPref(e.type, { inApp: v })} />
              </View>
              {e.mandatory ? (
                <Text style={styles.sub}>Always on: this one cannot be switched off.</Text>
              ) : (
                <View style={styles.choices}>
                  {EMAIL_CHOICES.map((c) => (
                    <Pressable key={c.key} onPress={() => setPref(e.type, { email: c.key })} style={[styles.choice, e.email === c.key && styles.choiceOn]} accessibilityRole="button" accessibilityState={{ selected: e.email === c.key }}>
                      <Text style={[styles.choiceText, e.email === c.key && { color: colors.white }]}>{c.label}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          ))}
          {prefsDirty && <Button label="Save choices" onPress={() => void savePrefs()} />}
        </View>

        <PasswordCard />
        <TwoFactorCard enabled={!!user?.mfaEnabled} onChanged={loadUser} />

        <Button label="Sign out" variant="outline" onPress={() => Alert.alert('Sign out', 'Are you sure?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => signOut() }])} />
      </ScrollView>
    </View>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const problem = next && next.length < 12 ? 'Use at least 12 characters.' : again && again !== next ? 'The two new passwords differ.' : undefined;

  async function change() {
    setBusy(true);
    try {
      await account.changePassword(current, next);
      setCurrent(''); setNext(''); setAgain('');
      Alert.alert('Password changed', 'Use the new password next time you sign in.');
    } catch (e) {
      Alert.alert('Could not change the password', errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={styles.card}>
      <Text style={styles.title}>PASSWORD</Text>
      <AppTextInput label="Current password" password value={current} onChangeText={setCurrent} autoCapitalize="none" />
      <AppTextInput label="New password" password value={next} onChangeText={setNext} autoCapitalize="none" error={problem && next.length < 12 ? problem : undefined} />
      <AppTextInput label="New password again" password value={again} onChangeText={setAgain} autoCapitalize="none" error={again && again !== next ? problem : undefined} />
      <Button label={busy ? 'Changing…' : 'Change password'} disabled={busy || !current || next.length < 12 || next !== again} onPress={() => void change()} />
    </View>
  );
}

function TwoFactorCard({ enabled, onChanged }: { enabled: boolean; onChanged: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState('');
  const [disabling, setDisabling] = useState(false);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try { setSetup(await account.startMfa()); } catch (e) { Alert.alert('Could not start', errorMessage(e)); } finally { setBusy(false); }
  }
  async function confirm() {
    setBusy(true);
    try {
      const r = await account.confirmMfa(code.trim());
      setCodes(r.backupCodes); setSetup(null); setCode('');
      onChanged();
    } catch (e) { Alert.alert('That code did not work', errorMessage(e)); } finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true);
    try {
      await account.disableMfa(password);
      setPassword(''); setDisabling(false);
      onChanged();
    } catch (e) { Alert.alert('Could not turn it off', errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>TWO-FACTOR SIGN-IN</Text>
      {codes && (
        <View style={styles.codes}>
          <Text style={styles.entryTitle}>Save these backup codes now</Text>
          <Text style={styles.sub}>Each works once if you lose your phone. They are not shown again.</Text>
          <Text style={styles.mono} selectable>{codes.join('\n')}</Text>
          <Button label="I have saved them" variant="outline" onPress={() => setCodes(null)} />
        </View>
      )}
      {!codes && !enabled && !setup && (
        <>
          <Text style={styles.sub}>Adds a 6-digit code from an authenticator app each time you sign in.</Text>
          <Button label={busy ? 'Starting…' : 'Turn on'} disabled={busy} onPress={() => void start()} />
        </>
      )}
      {setup && (
        <>
          <Text style={styles.sub}>1. Open your authenticator app. If it is on this phone, tap the button; otherwise enter the key by hand.</Text>
          <Button label="Open in authenticator app" variant="outline" onPress={() => Linking.openURL(setup.otpauthUri).catch(() => Alert.alert('No authenticator app found', 'Enter the key below by hand.'))} />
          <Text style={styles.mono} selectable>{setup.secret}</Text>
          <Text style={styles.sub}>2. Enter the 6-digit code it shows.</Text>
          <AppTextInput label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={8} />
          <Button label={busy ? 'Checking…' : 'Confirm'} disabled={busy || code.trim().length < 6} onPress={() => void confirm()} />
        </>
      )}
      {!codes && enabled && !disabling && (
        <>
          <Text style={styles.sub}>On. A code is asked for at every sign-in.</Text>
          <Button label="Turn off" variant="outline" onPress={() => setDisabling(true)} />
        </>
      )}
      {enabled && disabling && (
        <>
          <Text style={styles.sub}>Enter your password to turn it off. Some roles must keep it on.</Text>
          <AppTextInput label="Password" password value={password} onChangeText={setPassword} autoCapitalize="none" />
          <View style={styles.row}>
            <Button label="Cancel" variant="outline" style={{ flex: 1 }} onPress={() => { setDisabling(false); setPassword(''); }} />
            <Button label={busy ? 'Working…' : 'Turn off'} disabled={busy || !password} style={{ flex: 1 }} onPress={() => void disable()} />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md },
  title: { ...typography.sectionTitle, color: colors.textMuted },
  name: { ...typography.h3, color: colors.textPrimary },
  role: { ...typography.bodySm, color: colors.accentPurpleFg, fontWeight: '700' },
  sub: { ...typography.bodySm, color: colors.textSecondary },
  err: { ...typography.bodySm, color: colors.danger },
  link: { ...typography.bodySm, color: colors.accentBlueFg, fontWeight: '700' },
  entry: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 },
  entryTitle: { ...typography.bodySm, fontWeight: '700', color: colors.textPrimary, flex: 1 },
  pref: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm },
  prefHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  choices: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  choice: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.chipBg },
  choiceOn: { backgroundColor: colors.textPrimary },
  choiceText: { ...typography.caption, fontWeight: '700', color: colors.chipFg },
  codes: { gap: spacing.md },
  mono: { fontFamily: 'monospace', fontSize: 15, color: colors.textPrimary, backgroundColor: colors.surfaceAlt, padding: spacing.md, borderRadius: radius.md },
  row: { flexDirection: 'row', gap: spacing.md },
});
