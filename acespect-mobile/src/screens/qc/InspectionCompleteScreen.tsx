import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { Button } from '../../components/ui';
import { AppScreenProps } from '../../navigation/types';
import * as qc from '../../services/qcPlatformApi';
import { flushQueue, queuedFor } from '../../services/inspectionQueue';

type Check = Awaited<ReturnType<typeof qc.completionCheck>>;

/** F14: every item answered, no draft defects, declaration accepted; then the inspection is signed and locked. */
export function QcInspectionCompleteScreen({ navigation, route }: AppScreenProps<'QcInspectionComplete'>) {
  const { inspectionId } = route.params;
  const [check, setCheck] = useState<Check | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [notes, setNotes] = useState('');
  const [limits, setLimits] = useState('');
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      await flushQueue(inspectionId);
      setWaiting((await queuedFor(inspectionId)).length);
      setCheck(await qc.completionCheck(inspectionId));
    } catch (e) {
      setError((e as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? 'Could not check this inspection. You need a connection to complete it.');
    }
  }, [inspectionId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const ok = !!check?.canComplete && waiting === 0;
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await qc.completeInspection(inspectionId, { declaration: true, overall_summary_notes: notes || undefined, limitations_statement: limits || undefined });
      navigation.navigate('QcInspections');
    } catch (e) {
      setError((e as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? 'Could not complete the inspection.');
    } finally { setBusy(false); }
  };

  const line = (good: boolean, text: string) => (
    <View style={styles.line}><Ionicons name={good ? 'checkmark-circle' : 'close-circle'} size={18} color={good ? '#15803d' : colors.danger} /><Text style={[styles.sub, { color: good ? '#15803d' : colors.danger, flex: 1 }]}>{text}</Text></View>
  );

  return (
    <View style={styles.root}>
      <InspectionHeader title="Complete and sign" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!check && !error && <ActivityIndicator color={colors.accentBlueFg} />}
        {check && (
          <View style={styles.card}>
            {line(waiting === 0, waiting === 0 ? 'Everything you recorded has been sent' : `${waiting} result(s) are still waiting to send`)}
            {line(check.unanswered.length === 0, check.unanswered.length === 0 ? 'Every item has a result' : `${check.unanswered.length} item(s) have no result: ${check.unanswered.slice(0, 8).join(', ')}`)}
            {line(check.draftDefects.length === 0, check.draftDefects.length === 0 ? 'No draft defects' : `${check.draftDefects.length} defect(s) are still drafts. Confirm or withdraw each one.`)}
            {check.draftDefects.map((d) => (
              <Pressable key={d.id} onPress={() => navigation.navigate('QcDefectDetail', { defectId: d.id })} style={styles.link} accessibilityRole="link">
                <Text style={styles.linkText}>Open {d.defectRef ?? 'draft defect'}</Text>
              </Pressable>
            ))}
            {line(check.hasSignature, check.hasSignature ? 'Your signature is on file' : 'Your signature image is not on file. Ask the platform administrator to add it.')}
          </View>
        )}
        <Text style={styles.label}>Overall summary notes</Text>
        <TextInput style={[styles.input, { minHeight: 80 }]} multiline value={notes} onChangeText={setNotes} />
        {!!check && check.notInspected > 0 && (
          <>
            <Text style={styles.label}>Limitations statement * ({check.notInspected} item(s) were not inspected)</Text>
            <TextInput style={[styles.input, { minHeight: 60 }]} multiline value={limits} onChangeText={setLimits} />
          </>
        )}
        <Pressable style={styles.checkRow} onPress={() => setDeclared(!declared)} accessibilityRole="checkbox" accessibilityState={{ checked: declared }}>
          <Ionicons name={declared ? 'checkbox' : 'square-outline'} size={22} color={colors.primary} />
          <Text style={[styles.sub, { flex: 1 }]}>I inspected the items as recorded and the results are accurate.</Text>
        </Pressable>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Button label="SIGN AND LOCK" onPress={submit} disabled={!ok || !declared || (!!check && check.notInspected > 0 && !limits.trim())} loading={busy} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sub: { ...typography.bodySm, color: colors.textSecondary },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', marginTop: spacing.md },
  input: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, padding: spacing.md, ...typography.body, color: colors.textPrimary, backgroundColor: colors.surface },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.md },
  link: { paddingVertical: 4 },
  linkText: { ...typography.bodySm, color: colors.accentBlueFg, fontWeight: '700' },
  error: { ...typography.bodySm, color: colors.danger },
});
