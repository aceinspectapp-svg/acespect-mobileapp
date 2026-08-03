import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../../theme';
import type { TemplateField, TemplateFieldType } from '../../../services/templateApi';
import { AnswerTree, AnswerValue, FieldRendererProps, isGateSatisfied } from './types';
import {
  ChipMultiSelectFieldRenderer,
  ColorSelectFieldRenderer,
  DateFieldRenderer,
  NumericFieldRenderer,
  PhotosFieldRenderer,
  PillSelectFieldRenderer,
  SelectTilesFieldRenderer,
  TextFieldRenderer,
  TextareaFieldRenderer,
  YesNoFieldRenderer,
} from './leafRenderers';

/**
 * Renders one level of a template's fields against one scope of the answer
 * tree -- the mobile equivalent of the web admin's recursive
 * `FieldListEditor`. `RepeatingGroupFieldRenderer`/`DamageListFieldRenderer`
 * call this again for each instance, which is how nested repetition (e.g.
 * InternalAreas' room types containing addable instances containing a
 * damage-list) "just works" without special-casing.
 */
export function FieldListRenderer({
  fields,
  scope,
  onChange,
  path,
}: {
  fields: TemplateField[];
  scope: AnswerTree;
  onChange: (key: string, value: AnswerValue) => void;
  path: string[];
}) {
  const visible = [...fields].filter((f) => isGateSatisfied(f, scope)).sort((a, b) => a.order - b.order);
  let lastLetter: string | undefined;
  return (
    <>
      {visible.map((field) => {
        const Renderer = FIELD_RENDERERS[field.type];
        if (!Renderer) return null;
        const showLetterHeader = field.sectionLetter && field.sectionLetter !== lastLetter;
        lastLetter = field.sectionLetter;
        return (
          <React.Fragment key={field.key}>
            {showLetterHeader && (
              <View style={styles.letterHeaderBand}>
                <Text style={styles.letterHeaderText}>
                  {field.sectionLetter && field.sectionLetter.length <= 2 ? `SECTION ${field.sectionLetter}` : field.sectionLetter}
                </Text>
              </View>
            )}
            <Renderer
              field={field}
              value={scope[field.key]}
              onChange={(v) => onChange(field.key, v)}
              path={[...path, field.key]}
            />
          </React.Fragment>
        );
      })}
    </>
  );
}

function asAnswerTree(v: AnswerValue): AnswerTree {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as AnswerTree) : {};
}

/**
 * repeating-group / damage-list share this renderer: both are a list of
 * instances, each rendering `itemFields` via FieldListRenderer. Only the
 * chrome (tab strip vs scrollable strip vs checklist rows) and defaults
 * differ, driven by `field.repeat`.
 */
export function RepeatingFieldRenderer(props: FieldRendererProps) {
  const presentation = props.field.repeat?.presentation ?? 'strip';
  if (presentation === 'checklist') return <ChecklistRenderer {...props} />;
  if (presentation === 'fixed-tabs' || presentation === 'nested') return <FixedTabsRenderer {...props} />;
  return <StripListRenderer {...props} />;
}

/** Fixed rows, each an implicit yes/no + conditional note (e.g. NotesPostProject's movement checklist). No hooks needed. */
function ChecklistRenderer({ field, value, onChange, path }: FieldRendererProps) {
  const itemFields = field.itemFields ?? [];
  const record = asAnswerTree(value) as unknown as Record<string, AnswerTree>;
  return (
    <View style={styles.block}>
      <Text style={styles.groupLabel}>{field.label}</Text>
      {(field.repeat?.fixedInstances ?? []).map((inst) => {
        const instScope = record[inst.key] ?? {};
        return (
          <View key={inst.key} style={styles.checklistRow}>
            <FieldListRenderer
              fields={itemFields.map((f) => (f.key === 'value' ? { ...f, label: inst.label } : f))}
              scope={instScope}
              onChange={(k, v) => onChange({ ...record, [inst.key]: { ...instScope, [k]: v } })}
              path={[...path, inst.key]}
            />
          </View>
        );
      })}
    </View>
  );
}

/** Fixed named tabs (Elevations' 4 sides, RoofChimneys' 2) or a fixed set with addable extra instances (InternalAreas' room types). */
function FixedTabsRenderer({ field, value, onChange, path }: FieldRendererProps) {
  const repeat = field.repeat ?? { presentation: 'fixed-tabs' as const };
  const itemFields = field.itemFields ?? [];
  const record = asAnswerTree(value) as unknown as Record<string, AnswerTree>;
  const fixedInstances = repeat.fixedInstances ?? [];
  const [extraInstances, setExtraInstances] = useState<{ key: string; label: string }[]>([]);
  const allInstances = [...fixedInstances, ...extraInstances];
  const [activeKey, setActiveKey] = useState<string>(allInstances[0]?.key ?? '');
  const active = allInstances.find((i) => i.key === activeKey) ?? allInstances[0];

  function addInstance() {
    const n = extraInstances.length + 1;
    const base = fixedInstances[0]?.label ?? field.label;
    const inst = { key: `extra_${Date.now()}_${n}`, label: `${base} ${fixedInstances.length + n}` };
    setExtraInstances((prev) => [...prev, inst]);
    setActiveKey(inst.key);
  }

  return (
    <View style={styles.block}>
      <Text style={styles.groupLabel}>{field.label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabStrip}>
        {allInstances.map((inst) => {
          const isActive = inst.key === active?.key;
          return (
            <Pressable
              key={inst.key}
              onPress={() => setActiveKey(inst.key)}
              style={[styles.tab, isActive && styles.tabActive]}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{inst.label}</Text>
            </Pressable>
          );
        })}
        {repeat.addable && (
          <Pressable onPress={addInstance} style={styles.tab}>
            <Ionicons name="add" size={14} color={colors.barBlue} />
          </Pressable>
        )}
      </ScrollView>
      {active && (
        <View style={styles.instanceCard}>
          <FieldListRenderer
            fields={itemFields}
            scope={record[active.key] ?? {}}
            onChange={(k, v) => onChange({ ...record, [active.key]: { ...(record[active.key] ?? {}), [k]: v } })}
            path={[...path, active.key]}
          />
        </View>
      )}
    </View>
  );
}

/** Scrollable, freely addable list of instances (most sections) or a damage-list. No hooks needed -- state lives in the answer tree. */
function StripListRenderer({ field, value, onChange, path }: FieldRendererProps) {
  const itemFields = field.itemFields ?? [];
  const list = Array.isArray(value) ? (value as AnswerTree[]) : [];

  function updateInstance(idx: number, k: string, v: AnswerValue) {
    const next = [...list];
    next[idx] = { ...(next[idx] ?? {}), [k]: v };
    onChange(next);
  }
  function addInstance() {
    onChange([...list, {}]);
  }
  function removeInstance(idx: number) {
    onChange(list.filter((_, i) => i !== idx));
  }

  return (
    <View style={styles.block}>
      <Text style={styles.groupLabel}>{field.label}</Text>
      {list.map((instScope, idx) => {
        const titleKey = field.repeat?.titleFieldKey;
        const customTitle = titleKey ? (instScope[titleKey] as string | undefined) : undefined;
        return (
        <View key={idx} style={styles.instanceCard}>
          <View style={styles.instanceHeader}>
            <Text style={styles.instanceTitle}>
              {customTitle?.trim()
                ? customTitle
                : field.type === 'damage-list' ? `Item ${idx + 1}` : `${field.label} ${idx + 1}`}
            </Text>
            {(list.length > 1 || field.type === 'damage-list') && (
              <Pressable onPress={() => removeInstance(idx)} hitSlop={8}>
                <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
              </Pressable>
            )}
          </View>
          <FieldListRenderer
            fields={itemFields}
            scope={instScope}
            onChange={(k, v) => updateInstance(idx, k, v)}
            path={[...path, String(idx)]}
          />
        </View>
        );
      })}
      {(field.repeat?.addable ?? true) && (
        <Pressable onPress={addInstance} style={styles.addBtn}>
          <Ionicons name="add" size={14} color={colors.barBlue} />
          <Text style={styles.addBtnText}>{field.repeat?.addButtonLabel ?? `Add ${field.label}`}</Text>
        </Pressable>
      )}
    </View>
  );
}

export const FIELD_RENDERERS: Record<TemplateFieldType, React.ComponentType<FieldRendererProps>> = {
  text: TextFieldRenderer,
  textarea: TextareaFieldRenderer,
  numeric: NumericFieldRenderer,
  date: DateFieldRenderer,
  yesno: YesNoFieldRenderer,
  'pill-select': PillSelectFieldRenderer,
  'select-tiles': SelectTilesFieldRenderer,
  'color-select': ColorSelectFieldRenderer,
  'chip-multiselect': ChipMultiSelectFieldRenderer,
  photos: PhotosFieldRenderer,
  'repeating-group': RepeatingFieldRenderer,
  'damage-list': RepeatingFieldRenderer,
};

export * from './types';

const styles = StyleSheet.create({
  block: { marginBottom: spacing.lg },
  letterHeaderBand: {
    backgroundColor: colors.accentBlue,
    borderLeftWidth: 4,
    borderLeftColor: colors.barBlue,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    marginTop: spacing.md,
  },
  letterHeaderText: {
    ...typography.label,
    color: colors.barBlue,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  groupLabel: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
  tabStrip: { marginBottom: spacing.md },
  tab: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: { borderColor: colors.barBlue, backgroundColor: colors.accentBlue },
  tabText: { ...typography.bodySm, color: colors.textSecondary },
  tabTextActive: { color: colors.barBlue, fontWeight: '700' },
  instanceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  instanceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  instanceTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  checklistRow: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.md, marginBottom: spacing.md },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignSelf: 'flex-start',
  },
  addBtnText: { ...typography.bodySm, color: colors.barBlue, fontWeight: '600' },
});
