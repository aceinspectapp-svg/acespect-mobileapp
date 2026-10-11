import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { Button } from '../../components/ui';
import { PickerSheet } from '../../components/qc/PickerSheet';
import { AppScreenProps } from '../../navigation/types';
import * as qc from '../../services/qcApi';
import * as platform from '../../services/qcPlatformApi';
import { errorMessage } from '../../services/qcCache';
import { QcLot, QcProject } from '../../types/qc';

const TYPES = ['Ad-hoc visit', 'Re-inspection', 'DLP inspection', 'Combined stage visit'];

/** An unplanned inspection (an inspector's own visit): project, optional lot, what it is for. It opens ready to start. */
export function QcNewInspectionScreen({ navigation }: AppScreenProps<'QcNewInspection'>) {
  const [projects, setProjects] = useState<QcProject[]>([]);
  const [lots, setLots] = useState<QcLot[]>([]);
  const [project, setProject] = useState<QcProject | null>(null);
  const [lot, setLot] = useState<QcLot | null>(null);
  const [type, setType] = useState(TYPES[0]!);
  const [purpose, setPurpose] = useState('');
  const [sheet, setSheet] = useState<'project' | 'lot' | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => { qc.listProjects().then((r) => setProjects(r.data)).catch((e) => setLoadError(errorMessage(e, 'Could not load your projects'))); }, []);
  useEffect(() => {
    setLot(null);
    setLots([]);
    if (project) qc.listLots(project.id).then((r) => setLots(r.data)).catch(() => undefined);
  }, [project]);
  const shown = useMemo(() => lots.filter((l) => l.name.toLowerCase().includes(search.trim().toLowerCase())), [lots, search]);

  async function create() {
    if (!project || busy) return;
    setBusy(true);
    try {
      const inspection = await platform.createAdHocInspection({ projectId: project.id, propertyId: lot?.id, type, purpose: purpose.trim() || undefined });
      navigation.replace('QcInspection', { inspectionId: inspection.id });
    } catch (e) {
      Alert.alert('Could not create the inspection', errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <InspectionHeader title="New inspection" subtitle="An unplanned visit" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!!loadError && <Text style={styles.error}>{loadError}</Text>}
        <View style={styles.card}>
          <Text style={styles.title}>WHERE</Text>
          <Pressable style={styles.pick} onPress={() => setSheet('project')} accessibilityRole="button" accessibilityLabel="Choose project">
            <Text style={project ? styles.value : styles.placeholder}>{project?.name ?? 'Choose the project'}</Text>
            <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable style={[styles.pick, !project && { opacity: 0.5 }]} disabled={!project} onPress={() => setSheet('lot')} accessibilityRole="button" accessibilityLabel="Choose lot">
            <Text style={lot ? styles.value : styles.placeholder}>{lot ? lot.name : 'A lot (optional)'}</Text>
            <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
        <View style={styles.card}>
          <Text style={styles.title}>WHAT KIND</Text>
          <View style={styles.chips}>
            {TYPES.map((t) => (
              <Pressable key={t} onPress={() => setType(t)} style={[styles.chip, type === t && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: type === t }}>
                <Text style={[styles.chipText, type === t && { color: colors.white }]}>{t}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.title}>PURPOSE</Text>
          <TextInput style={styles.input} value={purpose} onChangeText={setPurpose} placeholder="Why are you inspecting?" placeholderTextColor={colors.textMuted} multiline />
        </View>
        <SafeAreaView edges={['bottom']}>
          <Button label={busy ? 'Creating…' : 'Create inspection'} disabled={!project || busy} onPress={() => void create()} />
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
          <TextInput style={styles.input} value={search} onChangeText={setSearch} placeholder="Search lots" placeholderTextColor={colors.textMuted} autoCorrect={false} />
          <Pressable style={styles.option} onPress={() => { setLot(null); setSheet(null); }}><Text style={styles.optionText}>No specific lot</Text></Pressable>
          {shown.map((l) => (
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
  value: { ...typography.body, color: colors.textPrimary, fontWeight: '600', flex: 1 },
  placeholder: { ...typography.body, color: colors.textMuted, flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.chipBg },
  chipOn: { backgroundColor: colors.textPrimary },
  chipText: { ...typography.caption, fontWeight: '700', color: colors.chipFg },
  input: { minHeight: 44, ...typography.body, color: colors.textPrimary, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  sheet: { padding: spacing.lg, gap: spacing.sm },
  option: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  optionText: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
});
