import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography } from '../../theme';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { Button } from '../../components/ui';
import { AppScreenProps } from '../../navigation/types';
import { mediaUri } from '../../config/api';
import * as qc from '../../services/qcApi';
import { errorMessage } from '../../services/qcCache';
import { QcProject, QcProjectDocument } from '../../types/qc';

/** The projects you work on. Tap one for its documents (drawings, specifications, reports). */
export function QcProjectsScreen({ navigation }: AppScreenProps<'QcProjects'>) {
  const [projects, setProjects] = useState<QcProject[] | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await qc.listProjects();
      setProjects(r.data);
      setStale(r.stale);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, 'Could not load projects'));
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <View style={styles.root}>
      <InspectionHeader title="Projects" subtitle="Documents and drawings" onBack={() => navigation.goBack()} />
      {stale && <Text style={styles.stale}>Offline: showing what was loaded last.</Text>}
      {loading && !projects && <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={colors.accentBlueFg} />}
      {!!error && !projects && (
        <View style={styles.centered}>
          <Text style={styles.error}>{error}</Text>
          <Button label="Retry" variant="outline" fitContent onPress={() => void load()} />
        </View>
      )}
      <FlatList
        data={projects ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={load}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('QcProjectDocs', { projectId: item.id, name: item.name })} style={styles.card} accessibilityRole="button">
            <Ionicons name="folder-open-outline" size={24} color={colors.accentBlueFg} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.sub}>{[item.client?.name, item.projectRef, item.status?.replace(/_/g, ' ').toLowerCase()].filter(Boolean).join(' · ')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        )}
        ListEmptyComponent={!loading && !error ? <Text style={styles.empty}>No projects yet.</Text> : null}
      />
    </View>
  );
}

/** One project's documents. A file opens in the phone's own viewer through a short-lived link. */
export function QcProjectDocsScreen({ navigation, route }: AppScreenProps<'QcProjectDocs'>) {
  const { projectId, name } = route.params;
  const [docs, setDocs] = useState<QcProjectDocument[] | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await qc.listProjectDocuments(projectId);
      setDocs(r.data);
      setStale(r.stale);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, 'Could not load documents'));
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const text = (d: QcProjectDocument, k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '');

  return (
    <View style={styles.root}>
      <InspectionHeader title="Documents" subtitle={name} onBack={() => navigation.goBack()} />
      {stale && <Text style={styles.stale}>Offline: showing what was loaded last. Files need a connection to open.</Text>}
      {loading && !docs && <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={colors.accentBlueFg} />}
      {!!error && !docs && <Text style={[styles.error, { textAlign: 'center', margin: spacing.xl }]}>{error}</Text>}
      <FlatList
        data={docs ?? []}
        keyExtractor={(d) => d.id}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={load}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => { const u = text(item, 'fileUrl'); if (u) Linking.openURL(mediaUri(u)).catch(() => undefined); }}
            style={styles.card}
            accessibilityRole="button"
            accessibilityLabel={`Open ${text(item, 'title')}`}
          >
            <Ionicons name={/\.(png|jpe?g|webp)$/i.test(text(item, 'fileName')) ? 'image-outline' : 'document-text-outline'} size={24} color={colors.accentBlueFg} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{text(item, 'title') || text(item, 'fileName') || 'Document'}</Text>
              <Text style={styles.sub}>
                {[text(item, 'document_type'), text(item, 'revision') ? `Rev ${text(item, 'revision')}` : '', text(item, 'issue_date')].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.textMuted} />
          </Pressable>
        )}
        ListEmptyComponent={!loading && !error ? <Text style={styles.empty}>No documents have been shared with you on this project.</Text> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', padding: spacing.xxxl, gap: spacing.md },
  error: { ...typography.bodySm, color: colors.danger },
  stale: { ...typography.caption, color: colors.warning, textAlign: 'center', marginTop: spacing.sm },
  list: { padding: spacing.lg, flexGrow: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md, ...shadows.card },
  name: { ...typography.bodySm, fontWeight: '700', color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  empty: { ...typography.bodySm, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xxxl },
});
