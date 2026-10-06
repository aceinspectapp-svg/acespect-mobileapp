import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography } from '../../theme';
import { InspectionHeader, HeaderAction } from '../../components/inspection/InspectionHeader';
import { SeverityPill } from '../../components/qc/SeverityPill';
import { StatusBadge } from '../../components/qc/StatusBadge';
import { SyncBanner } from '../../components/qc/SyncBanner';
import { Button } from '../../components/ui';
import { AppScreenProps } from '../../navigation/types';
import * as qc from '../../services/qcApi';
import { errorMessage } from '../../services/qcCache';
import { discardEntry } from '../../services/defectQueue';
import { useDefectSync } from '../../hooks/useDefectSync';
import { useQcMe } from '../../hooks/useQcMe';
import { QcConfigBundle, QcDefect } from '../../types/qc';

const ALL = 'all';
const DRAFTS = 'drafts';

/**
 * Every defect this person may see, whatever their role: an inspector's own drafts and open items, a site
 * supervisor's or trade's released work. Filter by status or severity, search, and (for inspectors) release
 * several confirmed defects at once. Works from the last load when there is no signal.
 */
export function QcMyDefectsScreen({ navigation, route }: AppScreenProps<'QcMyDefects'>) {
  const { me, can } = useQcMe();
  const [defects, setDefects] = useState<QcDefect[] | null>(null);
  const [config, setConfig] = useState<QcConfigBundle | null>(null);
  const [status, setStatus] = useState<string>(route.params?.status ?? ALL);
  const [severity, setSeverity] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await qc.listDefects({
        status: status !== ALL && status !== DRAFTS ? status : undefined,
        draft: status === DRAFTS ? true : undefined,
        severity: severity ?? undefined,
        q: query || undefined,
      });
      setDefects(r.data);
      setStale(r.stale);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, 'Could not load defects'));
    } finally {
      setLoading(false);
    }
  }, [status, severity, query]);

  const sync = useDefectSync(load);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => { qc.getConfig().then(setConfig).catch(() => undefined); }, []);
  useEffect(() => { const t = setTimeout(() => setQuery(search.trim()), 350); return () => clearTimeout(t); }, [search]);

  const waiting = useMemo(() => sync.entries.filter((e) => e.op.kind === 'create'), [sync.entries]);
  const canRelease = me?.role === 'PRIVATE_INSPECTOR';
  const releasable = (d: QcDefect) => !d.isDraft && d.status.key === 'open';

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function releasePicked() {
    if (picked.size === 0 || busy) return;
    setBusy(true);
    try {
      const results = await qc.bulkReleaseDefects([...picked]);
      const bad = results.filter((r) => !r.ok);
      Alert.alert(
        bad.length ? 'Some could not be released' : 'Released',
        bad.length ? bad.map((b) => b.message ?? 'Could not release').join('\n') : `${results.length} defect${results.length === 1 ? '' : 's'} released to the builder.`,
      );
      setPicked(new Set());
      setSelecting(false);
      void load();
    } catch (e) {
      Alert.alert('Could not release', errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const statusChips = [
    { key: ALL, label: 'All' },
    ...(can('defects.create') ? [{ key: DRAFTS, label: 'Drafts' }] : []),
    ...(config?.statuses ?? []).map((s) => ({ key: s.key, label: s.label })),
  ];

  const headerActions: HeaderAction[] = [];
  if (canRelease) {
    headerActions.push({
      icon: selecting ? 'close' : 'checkbox-outline',
      onPress: () => { setSelecting((s) => !s); setPicked(new Set()); },
      accessibilityLabel: selecting ? 'Stop selecting' : 'Select defects to release',
    });
  }
  if (can('defects.create')) headerActions.push({ icon: 'add-circle-outline', onPress: () => navigation.navigate('QcNewDefect'), accessibilityLabel: 'New defect' });

  return (
    <View style={styles.root}>
      <InspectionHeader title="Defects" subtitle={me ? 'Everything you can see' : undefined} onBack={() => navigation.goBack()} actions={headerActions} />
      <SyncBanner pending={sync.pending} failed={sync.failed} syncing={sync.syncing} onPress={() => (sync.failed ? navigation.navigate('QcAccount') : void sync.syncNow())} />

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder="Search reference, title, location"
          placeholderTextColor={colors.textMuted}
          returnKeyType="search"
          autoCorrect={false}
        />
        {!!search && (
          <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </Pressable>
        )}
      </View>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {statusChips.map((c) => (
            <Pressable key={c.key} onPress={() => setStatus(c.key)} style={[styles.chip, status === c.key && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: status === c.key }}>
              <Text style={[styles.chipText, status === c.key && styles.chipTextOn]}>{c.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Pressable onPress={() => setSeverity(null)} style={[styles.chip, !severity && styles.chipOn]}>
            <Text style={[styles.chipText, !severity && styles.chipTextOn]}>Any severity</Text>
          </Pressable>
          {(config?.severities ?? []).map((s) => (
            <Pressable key={s.key} onPress={() => setSeverity(severity === s.key ? null : s.key)} style={[styles.chip, severity === s.key && styles.chipOn]}>
              <Text style={[styles.chipText, severity === s.key && styles.chipTextOn]}>{s.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {stale && <Text style={styles.stale}>Offline: showing what was loaded last.</Text>}

      {loading && !defects && (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentBlueFg} />
        </View>
      )}
      {!!error && !defects && (
        <View style={styles.centered}>
          <Text style={styles.error}>{error}</Text>
          <Button label="Retry" variant="outline" fitContent onPress={() => void load()} />
        </View>
      )}

      <FlatList
        data={defects ?? []}
        keyExtractor={(d) => d.id}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={load}
        ListHeaderComponent={
          waiting.length ? (
            <View>
              {waiting.map((w) => {
                const body = (w.op.kind === 'create' ? w.op.body : {}) as Record<string, unknown>;
                return (
                  <View key={w.id} style={[styles.card, styles.waitingCard]}>
                    <Text style={styles.waitingTag}>{w.error ? 'Not accepted' : 'Waiting to send'}</Text>
                    <Text style={styles.summary}>{String(body.defect_title ?? 'New defect')}</Text>
                    <Text style={styles.meta}>{w.error ?? 'Created on this phone. It will be raised when you are back online.'}</Text>
                    {!!w.error && <Button label="Discard" variant="outline" fitContent style={{ marginTop: spacing.sm }} onPress={() => void discardEntry(w.id)} />}
                  </View>
                );
              })}
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const on = picked.has(item.id);
          const selectable = selecting && releasable(item);
          return (
            <Pressable
              onPress={() => {
                if (!selecting) navigation.navigate('QcDefectDetail', { defectId: item.id });
                else if (releasable(item)) toggle(item.id);
              }}
              style={[styles.card, on && styles.cardOn, selecting && !selectable && styles.cardDim]}
              accessibilityRole="button"
            >
              <View style={styles.cardTop}>
                {selecting && <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={selectable ? colors.accentBlueFg : colors.disabledFg} />}
                <SeverityPill severity={item.severity} />
                <StatusBadge status={item.status} />
                {item.flags.map((f) => <Text key={f} style={styles.flag}>{f}</Text>)}
              </View>
              <Text style={styles.summary}>{item.title ?? item.summary ?? 'Add defect details'}</Text>
              <Text style={styles.meta}>
                {item.defectRef ?? ''}
                {item.isDraft ? ' · Draft' : ''}
                {item.property ? ` · ${item.property.name}` : ''}
                {item.location ? ` · ${item.location}` : ''}
              </Text>
              <View style={styles.cardFooter}>
                <Text style={styles.crumb} numberOfLines={1}>{item.project.name}</Text>
                <Text style={styles.meta}>{item.dueDate ? `Due ${new Date(item.dueDate).toLocaleDateString()}` : ''}</Text>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={!loading && !error ? <Text style={styles.empty}>{query || status !== ALL || severity ? 'No defects match.' : 'No defects yet.'}</Text> : null}
      />

      {selecting && (
        <View style={styles.releaseBar}>
          <Text style={styles.releaseText}>{picked.size} selected</Text>
          <Button label={busy ? 'Releasing…' : 'Release to builder'} disabled={picked.size === 0 || busy} fitContent onPress={() => void releasePicked()} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxxl, gap: spacing.md },
  error: { ...typography.bodySm, color: colors.danger, textAlign: 'center' },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, margin: spacing.lg, marginBottom: spacing.sm, paddingHorizontal: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  search: { flex: 1, paddingVertical: spacing.md, ...typography.bodySm, color: colors.textPrimary },
  chips: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.chipBg },
  chipOn: { backgroundColor: colors.textPrimary },
  chipText: { ...typography.caption, fontWeight: '700', color: colors.chipFg },
  chipTextOn: { color: colors.white },
  stale: { ...typography.caption, color: colors.warning, textAlign: 'center', marginTop: spacing.xs },
  list: { padding: spacing.lg, paddingBottom: 100, flexGrow: 1 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md, ...shadows.card },
  cardOn: { borderColor: colors.accentBlueFg, backgroundColor: colors.accentBlue },
  cardDim: { opacity: 0.5 },
  waitingCard: { borderStyle: 'dashed' },
  waitingTag: { ...typography.caption, fontWeight: '800', color: colors.accentBlueFg, marginBottom: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  flag: { ...typography.caption, fontWeight: '700', color: '#9A3412', backgroundColor: '#FFEDD5', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, overflow: 'hidden', textTransform: 'capitalize' },
  summary: { ...typography.bodySm, fontWeight: '700', color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.sm },
  crumb: { ...typography.caption, color: colors.textSecondary, flexShrink: 1 },
  empty: { ...typography.bodySm, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xxxl },
  releaseBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
  },
  releaseText: { ...typography.bodySm, fontWeight: '700', color: colors.textPrimary },
});
