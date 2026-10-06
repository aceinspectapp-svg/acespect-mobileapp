import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { Button } from '../../components/ui';
import { PickerSheet } from '../../components/qc/PickerSheet';
import { RefOption, SpecFields, cleanValues } from '../../components/qc/SpecFields';
import { AppScreenProps } from '../../navigation/types';
import * as qc from '../../services/qcApi';
import { errorMessage } from '../../services/qcCache';
import { runOrQueue } from '../../services/defectQueue';
import { useQcMe } from '../../hooks/useQcMe';
import { useQcPhotoCapture } from '../../hooks/useQcPhotoCapture';
import { QcConfigBundle, QcLot, QcPhoto, QcProject, SpecForm } from '../../types/qc';

/**
 * Raise a defect from the field: choose the project and lot, describe it, attach photos. It is created as a draft
 * assigned to you; confirm it as Open from its page once it has a photo. With no signal the whole thing is kept on the
 * phone and raised later.
 */
export function QcNewDefectScreen({ navigation, route }: AppScreenProps<'QcNewDefect'>) {
  const { me } = useQcMe();
  const { takePhoto, pickFromLibrary } = useQcPhotoCapture();
  const [projects, setProjects] = useState<QcProject[]>([]);
  const [lots, setLots] = useState<QcLot[]>([]);
  const [project, setProject] = useState<QcProject | null>(null);
  const [lot, setLot] = useState<QcLot | null>(null);
  const [sheet, setSheet] = useState<'project' | 'lot' | null>(null);
  const [lotSearch, setLotSearch] = useState('');
  const [f16, setF16] = useState<SpecForm | null>(null);
  const [config, setConfig] = useState<QcConfigBundle | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [photos, setPhotos] = useState<QcPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    qc.listProjects().then((r) => setProjects(r.data)).catch((e) => setLoadError(errorMessage(e, 'Could not load your projects')));
    qc.getSpecForm('F16').then(setF16).catch(() => undefined);
    qc.getConfig().then(setConfig).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (route.params?.projectId && projects.length && !project) {
      const p = projects.find((x) => x.id === route.params!.projectId);
      if (p) setProject(p);
    }
  }, [route.params?.projectId, projects, project]);

  useEffect(() => {
    setLot(null);
    setLots([]);
    if (project) qc.listLots(project.id).then((r) => setLots(r.data)).catch((e) => setLoadError(errorMessage(e, 'Could not load lots')));
  }, [project]);

  const refOptions = useMemo<Record<string, RefOption[]>>(
    () => ({
      E19: (config?.tradeCategories ?? []).map((c) => ({ id: c.id, label: c.name })),
      E03: (config?.tradeCompanies ?? []).map((c) => ({ id: c.id, label: c.name })),
    }),
    [config],
  );
  const shownLots = useMemo(() => lots.filter((l) => l.name.toLowerCase().includes(lotSearch.trim().toLowerCase())), [lots, lotSearch]);

  async function save() {
    if (!lot || !me || busy) return;
    const body = { propertyId: lot.id, assignedToId: me.userId, ...cleanValues(values) };
    const uris = photos.map((p) => p.uri);
    setBusy(true);
    try {
      const outcome = await runOrQueue(() => qc.createDefect(body), { kind: 'create', body, photoUris: uris }, 'New defect');
      if (outcome.queued) {
        Alert.alert('Saved on this phone', 'There is no connection right now. The defect will be raised as soon as you are back online.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
        return;
      }
      const defect = outcome.result;
      if (uris.length) {
        const photoOutcome = await runOrQueue(() => qc.addDefectPhotos(defect.id, uris), { kind: 'photos', defectId: defect.id, photoUris: uris }, 'Defect photos');
        if (photoOutcome.queued) Alert.alert('Photos waiting', 'The defect was raised but the photos will be sent when you are back online.');
      }
      navigation.replace('QcDefectDetail', { defectId: defect.id });
    } catch (e) {
      Alert.alert('Could not save the defect', errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <InspectionHeader title="New defect" subtitle="Saved as a draft assigned to you" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!!loadError && <Text style={styles.error}>{loadError}</Text>}

        <View style={styles.card}>
          <Text style={styles.title}>WHERE</Text>
          <Pressable style={styles.pick} onPress={() => setSheet('project')} accessibilityRole="button" accessibilityLabel="Choose project">
            <Text style={project ? styles.pickValue : styles.pickPlaceholder}>{project?.name ?? 'Choose the project'}</Text>
            <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable style={[styles.pick, !project && { opacity: 0.5 }]} disabled={!project} onPress={() => setSheet('lot')} accessibilityRole="button" accessibilityLabel="Choose lot">
            <Text style={lot ? styles.pickValue : styles.pickPlaceholder}>{lot ? `${lot.name}${lot.site ? ` · ${lot.site.name}` : ''}` : 'Choose the lot'}</Text>
            <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
          </Pressable>
        </View>

        {lot && (
          <View style={styles.card}>
            <Text style={styles.title}>DETAILS</Text>
            {f16 ? (
              <SpecFields fields={f16.fields} values={values} onChange={setValues} refOptions={refOptions} />
            ) : (
              <ActivityIndicator color={colors.accentBlueFg} />
            )}
            <Text style={styles.hint}>You can leave any of this for later and finish it from the defect&apos;s page.</Text>
          </View>
        )}

        {lot && (
          <View style={styles.card}>
            <Text style={styles.title}>PHOTOS {photos.length ? `(${photos.length})` : ''}</Text>
            <View style={styles.row}>
              <Button label="Add" variant="outline" leftIcon="images-outline" style={{ flex: 1 }} onPress={async () => { const p = await pickFromLibrary(); if (p) setPhotos((x) => [...x, ...p]); }} />
              <Button label="Capture" variant="primary" leftIcon="camera-outline" style={{ flex: 1 }} onPress={async () => { const p = await takePhoto(); if (p) setPhotos((x) => [...x, ...p]); }} />
            </View>
            {photos.length > 0 && (
              <View style={styles.photos}>
                {photos.map((p) => (
                  <View key={p.id}>
                    <Image source={{ uri: p.uri }} style={styles.photo} />
                    <Pressable style={styles.remove} hitSlop={6} onPress={() => setPhotos((x) => x.filter((y) => y.id !== p.id))} accessibilityLabel="Remove photo">
                      <Ionicons name="close" size={12} color={colors.white} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        <SafeAreaView edges={['bottom']}>
          <Button label={busy ? 'Saving…' : 'Save draft'} disabled={!lot || busy} onPress={() => void save()} />
        </SafeAreaView>
      </ScrollView>

      <PickerSheet visible={sheet === 'project'} title="Project" onClose={() => setSheet(null)}>
        <View style={styles.sheet}>
          {projects.length === 0 && <Text style={styles.hint}>No projects available to you.</Text>}
          {projects.map((p) => (
            <Pressable key={p.id} style={styles.option} onPress={() => { setProject(p); setSheet(null); }}>
              <Text style={styles.optionText}>{p.name}</Text>
              {!!p.client && <Text style={styles.hint}>{p.client.name}</Text>}
            </Pressable>
          ))}
        </View>
      </PickerSheet>
      <PickerSheet visible={sheet === 'lot'} title="Lot" onClose={() => setSheet(null)}>
        <View style={styles.sheet}>
          <TextInput style={styles.search} value={lotSearch} onChangeText={setLotSearch} placeholder="Search lots" placeholderTextColor={colors.textMuted} autoCorrect={false} />
          {shownLots.length === 0 && <Text style={styles.hint}>{lots.length ? 'No lots match.' : 'This project has no lots yet.'}</Text>}
          {shownLots.map((l) => (
            <Pressable key={l.id} style={styles.option} onPress={() => { setLot(l); setSheet(null); }}>
              <Text style={styles.optionText}>{l.name}</Text>
              <Text style={styles.hint}>{[l.site?.name, l.propertyType?.label].filter(Boolean).join(' · ')}</Text>
            </Pressable>
          ))}
        </View>
      </PickerSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },
  error: { ...typography.bodySm, color: colors.danger },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md },
  title: { ...typography.sectionTitle, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textMuted },
  pick: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  pickValue: { ...typography.body, color: colors.textPrimary, fontWeight: '600', flex: 1 },
  pickPlaceholder: { ...typography.body, color: colors.textMuted, flex: 1 },
  row: { flexDirection: 'row', gap: spacing.md },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photo: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  remove: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface },
  sheet: { padding: spacing.lg, gap: spacing.sm },
  search: { ...typography.body, color: colors.textPrimary, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  option: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  optionText: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
});
