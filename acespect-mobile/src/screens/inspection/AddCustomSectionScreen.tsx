import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors, spacing, typography } from '../../theme';
import { AppTextInput, Button } from '../../components/ui';
import { InspectionHeader } from '../../components/inspection/InspectionHeader';
import { AppScreenProps } from '../../navigation/types';
import { useInspectionDraft } from '../../context/InspectionDraftContext';

/**
 * "Add extra structure / room" — for anything the fixed 13-section list
 * doesn't cover (a pergola, a granny flat, a spare room found on site).
 * Just collects a name here; the next screen renders the shared generic
 * `custom_structure` template (material, condition, defects, photos, notes)
 * under a key unique to this instance so any number of these can be added
 * side by side without colliding.
 */
export function AddCustomSectionScreen({ navigation }: AppScreenProps<'AddCustomSection'>) {
  const draft = useInspectionDraft();
  const [name, setName] = useState('');

  const trimmed = name.trim();

  function slugify(v: string): string {
    return v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'item';
  }

  function onCreate() {
    if (!trimmed) return;
    // Existing custom sections (any key not part of the fixed 13) so a
    // second "Shed" doesn't collide with the first.
    const existing = draft.getAllSections().filter((s) => s.key.startsWith('custom_'));
    let key = `custom_${slugify(trimmed)}`;
    if (existing.some((s) => s.key === key)) {
      let n = 2;
      while (existing.some((s) => s.key === `${key}_${n}`)) n += 1;
      key = `${key}_${n}`;
    }
    navigation.replace('CustomSection', { sectionKey: key, sectionName: trimmed });
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <InspectionHeader title="Add Extra Structure" onBack={() => navigation.goBack()} />
      <View style={styles.body}>
        <Text style={styles.helper}>
          Use this for anything on site that doesn't fit the standard sections — an extra
          shed, a pergola, a granny flat, a room found during the walk-through.
        </Text>
        <AppTextInput
          label="What is it?"
          required
          placeholder="e.g. Rear pergola, Bungalow, Store room"
          value={name}
          onChangeText={setName}
          autoFocus
        />
        <Text style={styles.hint}>
          You'll fill in material, condition, defects, photos and notes on the next screen —
          the same as any other section.
        </Text>
      </View>
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Button label="Continue" variant="primaryGradient" disabled={!trimmed} onPress={onCreate} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, padding: spacing.lg, gap: spacing.md },
  helper: { ...typography.bodySm, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textMuted },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
