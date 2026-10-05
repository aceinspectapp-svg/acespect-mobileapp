import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { mediaUri } from '../../config/api';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { Button } from '../../components/ui';
import { AppScreenProps } from '../../navigation/types';
import * as qc from '../../services/qcPlatformApi';
import { cacheInspection, cachedInspection, enqueue, flushQueue, queuedFor, QueuedResult } from '../../services/inspectionQueue';
import { useQcPhotoCapture } from '../../hooks/useQcPhotoCapture';

const GLYPH: Record<string, string> = { OK: '✓', 'Minor Defect': '▲', 'Major Defect': '◆', 'Safety Hazard': '⚠', 'Monitor / Serviceability': '◉', 'N/A': '–', 'Not Inspected': '⊘' };
const DEFECT = ['Minor Defect', 'Major Defect', 'Safety Hazard', 'Monitor / Serviceability'];
const WEATHER = ['Fine', 'Overcast', 'Showers', 'Rain', 'Recent rain (ground wet)', 'Hot (over 35 degrees C)', 'Windy'];

function errMsg(e: unknown): string {
  const r = (e as { response?: { data?: { error?: { message?: string } } } }).response;
  return r?.data?.error?.message ?? (e instanceof Error ? e.message : 'Something went wrong');
}

/** Run an inspection: start it, record every item (works without signal), then complete and sign. */
export function QcInspectionScreen({ navigation, route }: AppScreenProps<'QcInspection'>) {
  const { inspectionId } = route.params;
  const [detail, setDetail] = useState<qc.InspectionDetail | null>(null);
  const [queue, setQueue] = useState<QueuedResult[]>([]);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const q = await queuedFor(inspectionId);
    setQueue(q);
    try {
      const flushed = await flushQueue(inspectionId);
      setOffline(flushed.offline);
      setQueue(await queuedFor(inspectionId));
      const fresh = await qc.getInspection(inspectionId);
      setDetail(fresh);
      cacheInspection(fresh);
      setError(null);
    } catch (e) {
      const cached = await cachedInspection(inspectionId);
      if (cached) {
        setDetail(cached);
        setOffline(true);
      } else setError(errMsg(e));
    }
  }, [inspectionId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const insp = detail?.inspection;
  const editable = insp?.status === 'IN_PROGRESS' && !insp.locked;
  const pendingByItem = useMemo(() => new Map(queue.map((q) => [q.itemNumber, q])), [queue]);
  const sections = useMemo(() => {
    const m = new Map<string, qc.InspectionResult[]>();
    for (const r of insp?.results ?? []) {
      const s = String(r.item.section ?? 'General');
      m.set(s, [...(m.get(s) ?? []), r]);
    }
    return [...m.entries()];
  }, [insp]);

  if (!insp) {
    return (
      <View style={styles.root}>
        <InspectionHeader title="Inspection" onBack={() => navigation.goBack()} />
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={colors.accentBlueFg} />}
      </View>
    );
  }

  const send = async () => {
    setBusy(true);
    const r = await flushQueue(inspectionId).catch(() => ({ sent: 0, failed: 0, offline: true }));
    setOffline(r.offline);
    await load();
    setBusy(false);
    if (r.failed) Alert.alert('Some results were not accepted', 'Open the items marked with a warning and correct them.');
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <InspectionHeader title={`${insp.ref}: ${insp.stage?.stage_name ?? insp.type}`} subtitle={`${insp.project?.name ?? ''}${insp.lot ? ` · Lot ${insp.lot.name}` : ''}`} onBack={() => navigation.goBack()} />
      {(offline || queue.length > 0) && (
        <Pressable onPress={send} style={styles.banner} accessibilityRole="button">
          <Ionicons name={offline ? 'cloud-offline-outline' : 'cloud-upload-outline'} size={16} color="#92400e" />
          <Text style={styles.bannerText}>{queue.length > 0 ? `${queue.length} result${queue.length === 1 ? '' : 's'} waiting to send. Tap to retry.` : 'You are offline. Showing the last saved copy.'}</Text>
        </Pressable>
      )}
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {error && <Text style={styles.error}>{error}</Text>}

        {insp.status === 'PLANNED' && <StartCard id={inspectionId} onStarted={load} />}
        {insp.status === 'COMPLETED' && <Text style={styles.done}>🔒 Signed and locked. {insp.counts ? Object.entries(insp.counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`).join(' · ') : ''}</Text>}

        {sections.map(([section, items]) => (
          <View key={section}>
            <Text style={styles.section}>{section}</Text>
            {items.map((r) => (
              <ItemCard key={r.id} inspectionId={inspectionId} result={r} codes={detail!.resultCodes} editable={!!editable} pending={pendingByItem.get(r.itemNumber)} defects={detail!.defects} onSaved={load} />
            ))}
          </View>
        ))}

        {editable && <Button label="COMPLETE AND SIGN" onPress={() => navigation.navigate('QcInspectionComplete', { inspectionId })} loading={busy} />}
        {!editable && insp.status === 'IN_PROGRESS' && <Text style={styles.sub}>This inspection is locked.</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function StartCard({ id, onStarted }: { id: string; onStarted: () => void }) {
  const [weather, setWeather] = useState('Fine');
  const [temp, setTemp] = useState('');
  const [access, setAccess] = useState('Full');
  const [limits, setLimits] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Start this inspection</Text>
      <Text style={styles.label}>Weather</Text>
      <View style={styles.chips}>{WEATHER.map((w) => <Chip key={w} label={w} on={weather === w} onPress={() => setWeather(w)} />)}</View>
      <Text style={styles.label}>Temperature (°C)</Text>
      <TextInput style={styles.input} keyboardType="numeric" value={temp} onChangeText={setTemp} />
      <Text style={styles.label}>Site access</Text>
      <View style={styles.chips}>{['Full', 'Partial', 'Restricted'].map((a) => <Chip key={a} label={a} on={access === a} onPress={() => setAccess(a)} />)}</View>
      {access !== 'Full' && <><Text style={styles.label}>Access limitations</Text><TextInput style={[styles.input, { minHeight: 60 }]} multiline value={limits} onChangeText={setLimits} /></>}
      <Pressable style={styles.checkRow} onPress={() => setReviewed(!reviewed)} accessibilityRole="checkbox" accessibilityState={{ checked: reviewed }}>
        <Ionicons name={reviewed ? 'checkbox' : 'square-outline'} size={20} color={colors.primary} />
        <Text style={styles.sub}>I have reviewed any Monitor items carried forward on this lot.</Text>
      </Pressable>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Button label="START" loading={busy} onPress={async () => {
        setBusy(true); setError(null);
        try { await qc.startInspection(id, { weather, temperature: temp ? Number(temp) : undefined, site_access: access, access_limitations: limits || undefined, carriedForwardReviewed: reviewed, carried_forward_items_reviewed: reviewed }); onStarted(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
      }} />
    </View>
  );
}

const Chip = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
  <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
    <Text style={[styles.chipText, on && { color: colors.white }]}>{label}</Text>
  </Pressable>
);

function ItemCard({ inspectionId, result, codes, editable, pending, defects, onSaved }: {
  inspectionId: string; result: qc.InspectionResult; codes: qc.ResultCode[]; editable: boolean; pending?: QueuedResult; defects: qc.InspectionDetail['defects']; onSaved: () => void;
}) {
  const item = result.item;
  const p = pending?.payload as Record<string, any> | undefined;
  const [open, setOpen] = useState(!result.resultCode);
  const [code, setCode] = useState<string | null>((p?.result as string) ?? result.resultCode);
  const [comments, setComments] = useState<string>(p?.comments ?? result.comments ?? '');
  const [location, setLocation] = useState<string>(p?.locationDetail ?? result.locationDetail ?? '');
  const [reason, setReason] = useState<string>(p?.reason ?? result.reason ?? '');
  const [value, setValue] = useState<string>(p?.measurement ? String(p.measurement.value) : result.measurement ? String(result.measurement.value) : '');
  const [saved, setSaved] = useState<string[]>(pending?.photoUrls ?? result.photoUrls);
  const [local, setLocal] = useState<string[]>(pending?.photoUris ?? []);
  const [error, setError] = useState<string | null>(pending?.error ?? null);
  const [busy, setBusy] = useState(false);
  const { takePhoto } = useQcPhotoCapture();
  const isDefect = !!code && DEFECT.includes(code);
  const def = codes.find((c) => c.code === code);
  const mine = defects.filter((d) => d.sourceItemNumber === result.itemNumber);
  const done = result.resultCode;

  const save = async () => {
    if (!code) return;
    setBusy(true); setError(null);
    const payload = {
      result: code, comments, locationDetail: location, reason,
      measurement: item.item_type === 'Measurement' && value !== '' ? { value: Number(value), unit: item.measurement_unit } : undefined,
    };
    await enqueue({ inspectionId, itemNumber: result.itemNumber, payload, photoUris: local, photoUrls: saved.map((u) => u.split('?')[0]!) });
    const r = await flushQueue(inspectionId).catch(() => ({ sent: 0, failed: 0, offline: true }));
    const left = (await queuedFor(inspectionId)).find((q) => q.itemNumber === result.itemNumber);
    if (left?.error) setError(left.error);
    else if (r.offline) setError('Saved on this phone. It will send when you are back online.');
    setBusy(false);
    onSaved();
  };

  return (
    <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: done ? codes.find((c) => c.code === done)?.colour ?? colors.border : colors.border }]}>
      <Pressable onPress={() => setOpen(!open)} style={styles.itemHead} accessibilityRole="button">
        <View style={{ flex: 1 }}>
          <Text style={styles.itemNo}>{result.itemNumber}{result.carriedFromId ? ' · carried forward' : ''}</Text>
          <Text style={styles.cardTitle}>{item.check_description}</Text>
          <Text style={styles.sub}>{item.location_or_element}</Text>
        </View>
        <Text style={styles.resultText}>
          {pending ? (pending.error ? '⚠ ' : '⏳ ') : ''}{(pending?.payload.result as string) ?? done ? `${GLYPH[(pending?.payload.result as string) ?? done!]} ${(pending?.payload.result as string) ?? done}` : 'No result'}
        </Text>
      </Pressable>
      {(open || !done) && editable && (
        <View>
          <Text style={styles.sub}>{item.what_to_check_and_method} Guide: {item.guide_value_or_acceptable_tolerance}</Text>
          <View style={styles.chips}>
            {codes.map((c) => (
              <Pressable key={c.code} onPress={() => setCode(c.code)} accessibilityRole="radio" accessibilityState={{ selected: code === c.code }}
                style={[styles.codeBtn, { borderColor: c.colour }, code === c.code && { backgroundColor: c.colour }]}>
                <Text style={[styles.codeText, code === c.code && { color: colors.white }]}>{GLYPH[c.code]} {c.label}</Text>
              </Pressable>
            ))}
          </View>
          {!!def && <Text style={styles.hint}>{def.definition}</Text>}
          {item.item_type === 'Measurement' && <><Text style={styles.label}>Measured value ({item.measurement_unit})</Text><TextInput style={styles.input} keyboardType="numeric" value={value} onChangeText={setValue} /></>}
          {!!code && <><Text style={styles.label}>{isDefect ? 'Describe the defect *' : 'Comments'}</Text><TextInput style={[styles.input, { minHeight: 56 }]} multiline value={comments} onChangeText={setComments} /></>}
          {isDefect && <><Text style={styles.label}>Location detail *</Text><TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="For example Bed 2 north wall" /></>}
          {(code === 'N/A' || code === 'Not Inspected') && <><Text style={styles.label}>Reason *</Text><TextInput style={styles.input} value={reason} onChangeText={setReason} /></>}
          {!!code && (isDefect || item.photo_rule === 'Always' || saved.length + local.length > 0) && (
            <View>
              <Text style={styles.label}>Photos{isDefect ? ' *' : ''}</Text>
              <View style={styles.chips}>
                {saved.map((u) => <Image key={u} source={{ uri: mediaUri(u) }} style={styles.thumb} accessibilityLabel={`Evidence for item ${result.itemNumber}`} />)}
                {local.map((u) => <Image key={u} source={{ uri: u }} style={[styles.thumb, { opacity: 0.7 }]} accessibilityLabel="Photo waiting to upload" />)}
              </View>
              <Pressable style={styles.photoBtn} onPress={async () => { const ph = await takePhoto(); if (ph) setLocal((l) => [...l, ...ph.map((x) => x.uri)]); }} accessibilityRole="button">
                <Ionicons name="camera-outline" size={18} color={colors.accentBlueFg} /><Text style={styles.photoBtnText}>Take photo</Text>
              </Pressable>
            </View>
          )}
          {!!error && <Text style={styles.error}>{error}</Text>}
          <View style={{ height: spacing.md }} />
          <Button label="SAVE RESULT" onPress={save} disabled={!code || busy} loading={busy} />
        </View>
      )}
      {mine.length > 0 && <Text style={styles.sub}>Defects: {mine.map((d) => `${d.defectRef ?? 'defect'}${d.isDraft ? ' (draft)' : ''}`).join(', ')}</Text>}
      {!editable && (result.comments || result.locationDetail) && <Text style={styles.sub}>{[result.comments, result.locationDetail && `(${result.locationDetail})`].filter(Boolean).join(' ')}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing.xl, paddingBottom: spacing.xxxl * 2, gap: spacing.md },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: '#fffbeb', borderBottomWidth: 1, borderBottomColor: '#fde68a', paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  bannerText: { ...typography.caption, color: '#92400e', flex: 1 },
  section: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md, gap: spacing.sm },
  cardTitle: { ...typography.body, fontWeight: '700', color: colors.textPrimary },
  itemHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  itemNo: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  resultText: { ...typography.caption, fontWeight: '700', color: colors.textPrimary },
  sub: { ...typography.bodySm, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textSecondary },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', marginTop: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, padding: spacing.md, ...typography.body, color: colors.textPrimary, backgroundColor: colors.surface },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.headerGradientFrom, borderColor: colors.headerGradientFrom },
  chipText: { ...typography.caption, color: colors.textPrimary, fontWeight: '600' },
  codeBtn: { borderWidth: 2, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 8 },
  codeText: { ...typography.caption, fontWeight: '700', color: colors.textPrimary },
  thumb: { width: 72, height: 72, borderRadius: radius.md },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  photoBtnText: { ...typography.bodySm, color: colors.accentBlueFg, fontWeight: '700' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.sm },
  error: { ...typography.bodySm, color: colors.danger },
  done: { ...typography.bodySm, color: '#065f46', backgroundColor: '#ecfdf5', padding: spacing.md, borderRadius: radius.md },
});
