import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { Button } from '../../components/ui';
import { PickerSheet } from '../../components/qc/PickerSheet';
import { SeverityPill } from '../../components/qc/SeverityPill';
import { StatusBadge } from '../../components/qc/StatusBadge';
import { RefOption, SpecFields, cleanValues } from '../../components/qc/SpecFields';
import { AppScreenProps } from '../../navigation/types';
import { useQcData } from '../../context/QcDataContext';
import { useQcPhotoCapture } from '../../hooks/useQcPhotoCapture';
import { QcAllowedAction, QcConfigBundle, QcDefectDetail, QcDefectEvent, QcPhoto, SpecForm } from '../../types/qc';

const FLAG_LABEL: Record<string, string> = { urgent: 'Urgent', escalated: 'Escalated', overdue: 'Overdue' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The F16 form's values for a defect that already has some of them saved. */
function f16Initial(d: QcDefectDetail['defect']): Record<string, unknown> {
  return {
    defect_title: d.title ?? '',
    description: d.summary ?? '',
    room_or_area: d.roomArea ?? d.location ?? '',
    element: d.element ?? '',
    location_detail: d.locationDetails ?? '',
    severity: d.severity?.label ?? '',
    nature_of_defect: d.nature ?? '',
    code_or_standard_reference: d.codeRef ?? '',
    trade_category: d.tradeCategory?.id ?? '',
  };
}

/**
 * A defect starts as a draft: the admin (acespect-web) picked the lot and
 * assigned a person; that person fills in the details and photos here, then
 * confirms it as Open. From then on its status only moves through the
 * lifecycle actions the server offers this user (`allowedActions`).
 */
export function QcDefectDetailScreen({ navigation, route }: AppScreenProps<'QcDefectDetail'>) {
  const { defectId } = route.params;
  const { getDefectDetail, updateDefect, addDefectPhotos, getConfig, getSpecForm } = useQcData();
  const { takePhoto, pickFromLibrary } = useQcPhotoCapture();

  const [detail, setDetail] = useState<QcDefectDetail | null>(null);
  const [config, setConfig] = useState<QcConfigBundle | null>(null);
  const [f16, setF16] = useState<SpecForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<QcAllowedAction | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await getDefectDetail(defectId);
      setDetail(d);
      setValues(f16Initial(d.defect));
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load defect');
    }
  }, [defectId, getDefectDetail]);

  useEffect(() => {
    load();
    getConfig().then(setConfig).catch(() => {});
    getSpecForm('F16').then(setF16).catch(() => {});
  }, [load, getConfig, getSpecForm]);

  const refOptions = useMemo<Record<string, RefOption[]>>(
    () => ({
      E19: (config?.tradeCategories ?? []).map((c) => ({ id: c.id, label: c.name })),
      E03: (config?.tradeCompanies ?? []).map((c) => ({ id: c.id, label: c.name })),
    }),
    [config],
  );

  const defect = detail?.defect;

  async function saveDraft() {
    if (!defect || saving) return;
    setSaving(true);
    try {
      await updateDefect(defect.id, cleanValues(values));
      await load();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function addPhotos(source: 'camera' | 'library') {
    if (!defect) return;
    const picked = source === 'camera' ? await takePhoto() : await pickFromLibrary();
    if (!picked) return;
    try {
      await addDefectPhotos(defect.id, picked.map((p) => p.uri));
      await load();
    } catch (e) {
      Alert.alert('Could not upload photos', e instanceof Error ? e.message : 'Please try again.');
    }
  }

  const actions = defect?.allowedActions ?? [];

  return (
    <View style={styles.root}>
      <InspectionHeader
        title={defect?.defectRef ?? 'Defect'}
        subtitle={defect?.title ?? defect?.property.name}
        onBack={() => navigation.goBack()}
        actions={defect?.isDraft && dirty ? [{ icon: 'checkmark-circle', accessibilityLabel: 'Save draft', onPress: () => void saveDraft() }] : []}
      />

      {!detail && !error && (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentBlueFg} />
        </View>
      )}
      {error && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {detail && defect && (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.field}>
            <View style={styles.pillRow}>
              <StatusBadge status={defect.status} />
              <SeverityPill severity={defect.severity} />
              {defect.isDraft && <Text style={styles.draftTag}>Draft</Text>}
              {defect.flags.map((f) => (
                <Text key={f} style={styles.flagTag}>{FLAG_LABEL[f] ?? f}</Text>
              ))}
              {defect.reworkCount > 0 && <Text style={styles.flagTag}>Rework ×{defect.reworkCount}</Text>}
            </View>
            <Text style={styles.fieldValue}>{defect.client.name} › {defect.project.name} › {defect.property.name}</Text>
            {defect.isDraft && (
              <Text style={styles.hint}>This defect is a draft. Fill in the details, add at least one photo, then confirm it as Open.</Text>
            )}
          </View>

          {defect.isDraft && f16 ? (
            <View style={styles.field}>
              <Text style={styles.sectionTitle}>DETAILS</Text>
              <SpecFields
                fields={f16.fields}
                values={values}
                refOptions={refOptions}
                onChange={(next) => {
                  setValues(next);
                  setDirty(true);
                }}
              />
              <View style={{ marginTop: spacing.lg }}>
                <Button label={saving ? 'Saving…' : 'Save draft'} variant="outline" disabled={!dirty || saving} onPress={() => void saveDraft()} />
              </View>
            </View>
          ) : (
            <View style={styles.field}>
              <Text style={styles.sectionTitle}>DEFECT</Text>
              <Row label="Description" value={defect.summary} />
              <Row label="Room or area" value={defect.roomArea ?? defect.location} />
              <Row label="Element" value={defect.element} />
              <Row label="Location detail" value={defect.locationDetails} />
              <Row label="Nature" value={defect.nature} />
              <Row label="Code or standard" value={defect.codeRef} />
              <Row label="Trade category" value={defect.tradeCategory?.name} />
              <Row label="Target rectification" value={defect.targetRectificationDate ? new Date(defect.targetRectificationDate).toLocaleDateString() : null} />
              {defect.holdReason && <Row label="On hold" value={defect.holdReason} />}
            </View>
          )}

          <View style={styles.field}>
            <Text style={styles.sectionTitle}>PHOTOS ({defect.photoUrls.length})</Text>
            {defect.photoUrls.length > 0 && (
              <View style={styles.photoRow}>
                {defect.photoUrls.map((u) => <Image key={u} source={{ uri: u }} style={styles.photo} />)}
              </View>
            )}
            {defect.isDraft && (
              <View style={styles.photoActions}>
                <Button label="Add" variant="outline" leftIcon="images-outline" style={styles.photoBtn} onPress={() => void addPhotos('library')} />
                <Button label="Capture" variant="primary" leftIcon="camera-outline" style={styles.photoBtn} onPress={() => void addPhotos('camera')} />
              </View>
            )}
          </View>

          {actions.length > 0 && (
            <View style={styles.field}>
              <Text style={styles.sectionTitle}>ACTIONS</Text>
              <View style={{ gap: spacing.sm }}>
                {actions.map((a) => (
                  <Button
                    key={a.key}
                    label={a.label}
                    variant={a.key === 'confirm' ? 'primary' : 'outline'}
                    onPress={() => setAction(a)}
                  />
                ))}
              </View>
            </View>
          )}

          <View style={styles.field}>
            <Text style={styles.sectionTitle}>HISTORY ({detail.events.length})</Text>
            {detail.events.length === 0 && <Text style={styles.hint}>Nothing recorded yet.</Text>}
            {[...detail.events].reverse().map((e) => <EventRow key={e.id} e={e} />)}
          </View>
        </ScrollView>
      )}

      {action && defect && (
        <ActionSheet
          defect={defect}
          action={action}
          refOptions={refOptions}
          onClose={() => setAction(null)}
          onDone={(next) => {
            setAction(null);
            setDetail(next);
            setValues(f16Initial(next.defect));
            setDirty(false);
          }}
        />
      )}
    </View>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value || '—'}</Text>
    </View>
  );
}

function EventRow({ e }: { e: QcDefectEvent }) {
  return (
    <View style={styles.event}>
      <Text style={styles.eventTitle}>
        {e.type}
        {e.to && e.from?.key !== e.to.key ? `  ·  ${e.from?.label ?? '—'} → ${e.to.label}` : ''}
      </Text>
      <Text style={styles.eventMeta}>{e.actor.name ?? e.actor.email} · {formatTime(e.createdAt)}</Text>
      {!!e.note && <Text style={styles.eventNote}>{e.note}</Text>}
    </View>
  );
}

/** One lifecycle action: the fields come from the spec form (F16...F33), the rules are enforced by the server. */
function ActionSheet({ defect, action, refOptions, onClose, onDone }: {
  defect: QcDefectDetail['defect'];
  action: QcAllowedAction;
  refOptions: Record<string, RefOption[]>;
  onClose: () => void;
  onDone: (d: QcDefectDetail) => void;
}) {
  const { getSpecForm, postDefectAction } = useQcData();
  const { takePhoto, pickFromLibrary } = useQcPhotoCapture();
  const [form, setForm] = useState<SpecForm | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>(action.key === 'confirm' ? f16Initial(defect) : {});
  const [photos, setPhotos] = useState<QcPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSpecForm(action.form).then(setForm).catch((e) => setError(e instanceof Error ? e.message : 'Could not load the form'));
  }, [action.form, getSpecForm]);

  const hide =
    action.key === 'hold' ? ['action']
    : action.key === 'resume' ? ['action', 'reason_category', 'review_date', 'client_admin_confirmation']
    : [];
  const fields = (form?.fields ?? []).filter((f) => !hide.includes(f.key));
  const wantsPhotos = !!form?.fields.some((f) => f.kind === 'files');
  const photoRequired = !!form?.fields.some((f) => f.kind === 'files' && f.req === 'M');

  async function submit(extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const next = await postDefectAction(defect.id, action.key, { ...cleanValues(values), ...extra }, photos.map((p) => p.uri), defect.updatedAt);
      onDone(next);
    } catch (e) {
      const err = e as { response?: { data?: { error?: { code?: string; message?: string } } }; message?: string };
      const apiError = err.response?.data?.error;
      if (apiError?.code === 'CATEGORY_MISMATCH') {
        Alert.alert('Trade category mismatch', apiError.message ?? 'Allocate anyway?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Allocate anyway', onPress: () => void submit({ confirm_mismatch: true }) },
        ]);
      } else {
        setError(apiError?.message ?? err.message ?? 'Something went wrong');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <PickerSheet visible title={action.label} onClose={onClose}>
      <View style={styles.sheetBody}>
        {error && <Text style={styles.errorText}>{error}</Text>}
        {!form && !error && <ActivityIndicator color={colors.accentBlueFg} />}
        {form && (
          <>
            {action.key === 'confirm' && defect.photoUrls.length > 0 && (
              <Text style={styles.hint}>{defect.photoUrls.length} photo(s) already attached; add more here if you like.</Text>
            )}
            <SpecFields fields={fields} values={values} onChange={setValues} refOptions={refOptions} />
            {wantsPhotos && (
              <View>
                <Text style={styles.sectionTitle}>PHOTOS {photos.length > 0 ? `(${photos.length})` : ''}{photoRequired && action.key !== 'confirm' ? ' *' : ''}</Text>
                <View style={styles.photoActions}>
                  <Button label="Add" variant="outline" leftIcon="images-outline" style={styles.photoBtn} onPress={async () => { const p = await pickFromLibrary(); if (p) setPhotos((x) => [...x, ...p]); }} />
                  <Button label="Capture" variant="primary" leftIcon="camera-outline" style={styles.photoBtn} onPress={async () => { const p = await takePhoto(); if (p) setPhotos((x) => [...x, ...p]); }} />
                </View>
                {photos.length > 0 && (
                  <View style={styles.photoRow}>
                    {photos.map((p) => (
                      <View key={p.id}>
                        <Image source={{ uri: p.uri }} style={styles.photo} />
                        <Pressable style={styles.photoRemove} hitSlop={6} onPress={() => setPhotos((x) => x.filter((y) => y.id !== p.id))} accessibilityLabel="Remove photo">
                          <Ionicons name="close" size={12} color={colors.white} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}
            <SafeAreaView edges={['bottom']}>
              <Button label={busy ? 'Working…' : action.label} disabled={busy} onPress={() => void submit()} />
            </SafeAreaView>
          </>
        )}
      </View>
    </PickerSheet>
  );
}


const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  errorText: { ...typography.body, color: colors.danger, textAlign: 'center' },
  body: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },
  field: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sectionTitle: { ...typography.sectionTitle, color: colors.textMuted, marginBottom: spacing.xs },
  fieldValue: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  hint: { ...typography.bodySm, color: colors.textMuted },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  draftTag: { ...typography.caption, fontWeight: '700', color: colors.textSecondary, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3, overflow: 'hidden' },
  flagTag: { ...typography.caption, fontWeight: '700', color: '#9A3412', backgroundColor: '#FFEDD5', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: 3 },
  rowLabel: { ...typography.caption, color: colors.textMuted, width: 120 },
  rowValue: { ...typography.bodySm, color: colors.textPrimary, flex: 1 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  photo: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  photoActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  photoBtn: { flex: 1 },
  photoRemove: {
    position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface,
  },
  event: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  eventTitle: { ...typography.bodySm, fontWeight: '700', color: colors.textPrimary },
  eventMeta: { ...typography.caption, color: colors.textMuted, marginTop: 1 },
  eventNote: { ...typography.bodySm, color: colors.textSecondary, marginTop: 3 },
  sheetBody: { padding: spacing.xl, gap: spacing.lg },
});
